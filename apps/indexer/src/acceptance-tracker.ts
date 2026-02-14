/**
 * Acceptance Tracker
 *
 * Tracks acceptance status and confirmations for validated purchase attempts.
 * Updates accepted/acceptingBlockHash/acceptingBlueScore/confirmations fields.
 */

import type { PrismaClient, Sale, PurchaseAttempt } from '@prisma/client'
import type { KaspaAdapter, TransactionAcceptance } from '@tickasting/shared'

export interface AcceptanceTrackerConfig {
  /** Max number of txids to batch in a single API call */
  batchSize?: number
  logger?: {
    info: (msg: string, data?: unknown) => void
    error: (msg: string, data?: unknown) => void
    debug: (msg: string, data?: unknown) => void
  }
}

export interface TrackingResult {
  saleId: string
  updatedCount: number
  newlyAccepted: number
  newlyFinal: number
  errors: string[]
}

const defaultLogger = {
  info: (msg: string, data?: unknown) => console.log(`[AcceptanceTracker] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[AcceptanceTracker] ${msg}`, data ?? ''),
  debug: (msg: string, data?: unknown) => console.log(`[AcceptanceTracker:debug] ${msg}`, data ?? ''),
}

/**
 * Tracks acceptance status for purchase attempts
 */
export class AcceptanceTracker {
  private readonly prisma: PrismaClient
  private readonly adapter: KaspaAdapter
  private readonly config: Required<AcceptanceTrackerConfig>

  constructor(prisma: PrismaClient, adapter: KaspaAdapter, config: AcceptanceTrackerConfig = {}) {
    this.prisma = prisma
    this.adapter = adapter
    this.config = {
      batchSize: config.batchSize ?? 100,
      logger: config.logger ?? defaultLogger,
    }
  }

  /**
   * Track acceptance for all valid attempts in live sales
   */
  async track(): Promise<TrackingResult[]> {
    const results: TrackingResult[] = []

    // Get all live/finalizing sales
    const activeSales = await this.prisma.sale.findMany({
      where: {
        status: { in: ['live', 'finalizing'] },
      },
    })

    if (activeSales.length === 0) {
      this.config.logger.debug('No active sales to track')
      return results
    }

    for (const sale of activeSales) {
      const result = await this.trackSale(sale)
      results.push(result)
    }

    return results
  }

  /**
   * Track acceptance for a single sale
   */
  private async trackSale(sale: Sale): Promise<TrackingResult> {
    const result: TrackingResult = {
      saleId: sale.id,
      updatedCount: 0,
      newlyAccepted: 0,
      newlyFinal: 0,
      errors: [],
    }

    try {
      // Get all valid attempts that need tracking
      // (not yet final, meaning confirmations < finalityDepth)
      // Include both 'valid' and 'valid_fallback' statuses
      const attempts = await this.prisma.purchaseAttempt.findMany({
        where: {
          saleId: sale.id,
          validationStatus: { in: ['valid', 'valid_fallback'] },
          OR: [
            { accepted: false },
            { confirmations: { lt: sale.finalityDepth } },
          ],
        },
      })

      if (attempts.length === 0) {
        this.config.logger.debug(`No attempts to track for sale ${sale.id}`)
        return result
      }

      // Process in batches
      for (let i = 0; i < attempts.length; i += this.config.batchSize) {
        const batch = attempts.slice(i, i + this.config.batchSize)
        const batchResult = await this.trackBatch(batch, sale)

        result.updatedCount += batchResult.updatedCount
        result.newlyAccepted += batchResult.newlyAccepted
        result.newlyFinal += batchResult.newlyFinal
        result.errors.push(...batchResult.errors)
      }

      if (result.updatedCount > 0) {
        this.config.logger.info(
          `Tracked ${result.updatedCount} attempt(s) for sale ${sale.id}: ` +
            `${result.newlyAccepted} newly accepted, ${result.newlyFinal} newly final`
        )
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      result.errors.push(errorMsg)
      this.config.logger.error(`Error tracking sale ${sale.id}: ${errorMsg}`)
    }

    return result
  }

  /**
   * Track a batch of attempts
   */
  private async trackBatch(
    attempts: PurchaseAttempt[],
    sale: Sale
  ): Promise<{ updatedCount: number; newlyAccepted: number; newlyFinal: number; errors: string[] }> {
    const result = {
      updatedCount: 0,
      newlyAccepted: 0,
      newlyFinal: 0,
      errors: [] as string[],
    }

    try {
      const txids = attempts.map((a) => a.txid)
      const acceptanceData = await this.adapter.getTransactionsAcceptance(txids)

      // Create lookup map
      const acceptanceMap = new Map<string, TransactionAcceptance>()
      for (const acc of acceptanceData) {
        acceptanceMap.set(acc.txid, acc)
      }

      // Update each attempt
      for (const attempt of attempts) {
        const acceptance = acceptanceMap.get(attempt.txid)
        if (!acceptance) continue

        const wasAccepted = attempt.accepted
        const wasFinal = attempt.confirmations >= sale.finalityDepth

        // Prepare update data
        const updateData: Partial<PurchaseAttempt> & { lastCheckedAt: Date } = {
          accepted: acceptance.isAccepted,
          confirmations: acceptance.confirmations,
          lastCheckedAt: new Date(),
        }

        // Update accepting block hash if available
        if (acceptance.acceptingBlockHash && acceptance.acceptingBlockHash !== attempt.acceptingBlockHash) {
          updateData.acceptingBlockHash = acceptance.acceptingBlockHash

          // Fetch block details to get blueScore
          try {
            const block = await this.adapter.getBlockDetails(acceptance.acceptingBlockHash)
            if (block) {
              updateData.acceptingBlueScore = block.blueScore
            }
          } catch {
            // Non-critical, continue without blueScore
          }
        }

        // Update in database
        await this.prisma.purchaseAttempt.update({
          where: { id: attempt.id },
          data: updateData,
        })

        result.updatedCount++

        // Track state changes
        if (!wasAccepted && acceptance.isAccepted) {
          result.newlyAccepted++
        }
        if (!wasFinal && acceptance.confirmations >= sale.finalityDepth) {
          result.newlyFinal++
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      result.errors.push(errorMsg)
    }

    return result
  }
}

/**
 * Create and start an acceptance tracking loop
 */
export function createAcceptanceTrackerLoop(
  prisma: PrismaClient,
  adapter: KaspaAdapter,
  intervalMs: number,
  config: AcceptanceTrackerConfig = {}
): { stop: () => void } {
  const tracker = new AcceptanceTracker(prisma, adapter, config)
  let running = true
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const runLoop = async () => {
    if (!running) return

    try {
      await tracker.track()
    } catch (error) {
      const logger = config.logger ?? defaultLogger
      logger.error('Acceptance tracker loop error:', error)
    }

    if (running) {
      timeoutId = setTimeout(runLoop, intervalMs)
    }
  }

  // Start immediately
  runLoop()

  return {
    stop: () => {
      running = false
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
  }
}
