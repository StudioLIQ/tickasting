/**
 * Ordering Engine
 *
 * Computes deterministic ranks for purchase attempts based on:
 * - Primary key: acceptingBlueScore ASC
 * - Tie-breaker: txid lexicographic ASC
 *
 * Produces:
 * - provisionalRank: all accepted, valid attempts
 * - finalRank: only attempts with confirmations >= finalityDepth
 */

import type { PrismaClient, Sale, PurchaseAttempt } from '@prisma/client'

export interface OrderingConfig {
  logger?: {
    info: (msg: string, data?: unknown) => void
    error: (msg: string, data?: unknown) => void
    debug: (msg: string, data?: unknown) => void
  }
}

export interface OrderingResult {
  saleId: string
  provisionalRanked: number
  finalRanked: number
  errors: string[]
}

const defaultLogger = {
  info: (msg: string, data?: unknown) => console.log(`[Ordering] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[Ordering] ${msg}`, data ?? ''),
  debug: (msg: string, data?: unknown) => console.log(`[Ordering:debug] ${msg}`, data ?? ''),
}

/**
 * Sort function for deterministic ordering
 * Primary: blueScore ASC
 * Secondary: txid lexicographic ASC
 */
function compareAttempts(a: PurchaseAttempt, b: PurchaseAttempt): number {
  // Primary: blueScore ASC (null values go last)
  const aBlueScore = a.acceptingBlueScore ?? BigInt(Number.MAX_SAFE_INTEGER)
  const bBlueScore = b.acceptingBlueScore ?? BigInt(Number.MAX_SAFE_INTEGER)

  if (aBlueScore < bBlueScore) return -1
  if (aBlueScore > bBlueScore) return 1

  // Tie-breaker: txid lexicographic ASC
  return a.txid.localeCompare(b.txid)
}

/**
 * Ordering engine for computing deterministic ranks
 */
export class OrderingEngine {
  private readonly prisma: PrismaClient
  private readonly config: Required<OrderingConfig>

  constructor(prisma: PrismaClient, config: OrderingConfig = {}) {
    this.prisma = prisma
    this.config = {
      logger: config.logger ?? defaultLogger,
    }
  }

  /**
   * Compute ranks for all active sales
   */
  async computeRanks(): Promise<OrderingResult[]> {
    const results: OrderingResult[] = []

    // Get all live/finalizing sales
    const activeSales = await this.prisma.sale.findMany({
      where: {
        status: { in: ['live', 'finalizing'] },
      },
    })

    if (activeSales.length === 0) {
      this.config.logger.debug('No active sales to rank')
      return results
    }

    for (const sale of activeSales) {
      const result = await this.computeSaleRanks(sale)
      results.push(result)
    }

    return results
  }

  /**
   * Compute ranks for a single sale
   */
  async computeSaleRanks(sale: Sale): Promise<OrderingResult> {
    const result: OrderingResult = {
      saleId: sale.id,
      provisionalRanked: 0,
      finalRanked: 0,
      errors: [],
    }

    try {
      // Get all valid, accepted attempts for this sale
      // Include both 'valid' and 'valid_fallback' statuses
      const attempts = await this.prisma.purchaseAttempt.findMany({
        where: {
          saleId: sale.id,
          validationStatus: { in: ['valid', 'valid_fallback'] },
          accepted: true,
        },
      })

      if (attempts.length === 0) {
        this.config.logger.debug(`No valid accepted attempts for sale ${sale.id}`)
        return result
      }

      // Sort all attempts for provisional ranking
      const sortedAttempts = [...attempts].sort(compareAttempts)

      // Compute provisional ranks (1-indexed)
      const provisionalUpdates: { id: string; rank: number }[] = []
      for (let i = 0; i < sortedAttempts.length; i++) {
        const attempt = sortedAttempts[i]!
        const rank = i + 1
        if (attempt.provisionalRank !== rank) {
          provisionalUpdates.push({ id: attempt.id, rank })
        }
      }

      // Filter for final attempts (confirmations >= finalityDepth)
      const finalAttempts = sortedAttempts.filter(
        (a) => a.confirmations >= sale.finalityDepth
      )

      // Compute final ranks (1-indexed, sorted among final-only)
      const finalUpdates: { id: string; rank: number }[] = []
      for (let i = 0; i < finalAttempts.length; i++) {
        const attempt = finalAttempts[i]!
        const rank = i + 1
        if (attempt.finalRank !== rank) {
          finalUpdates.push({ id: attempt.id, rank })
        }
      }

      // Apply updates in a transaction
      if (provisionalUpdates.length > 0 || finalUpdates.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          // Update provisional ranks
          for (const update of provisionalUpdates) {
            await tx.purchaseAttempt.update({
              where: { id: update.id },
              data: { provisionalRank: update.rank },
            })
          }

          // Update final ranks
          for (const update of finalUpdates) {
            await tx.purchaseAttempt.update({
              where: { id: update.id },
              data: { finalRank: update.rank },
            })
          }
        })

        result.provisionalRanked = provisionalUpdates.length
        result.finalRanked = finalUpdates.length

        if (provisionalUpdates.length > 0 || finalUpdates.length > 0) {
          this.config.logger.info(
            `Updated ranks for sale ${sale.id}: ` +
              `${provisionalUpdates.length} provisional, ${finalUpdates.length} final`
          )
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      result.errors.push(errorMsg)
      this.config.logger.error(`Error computing ranks for sale ${sale.id}: ${errorMsg}`)
    }

    return result
  }
}

/**
 * Create and start an ordering loop
 */
export function createOrderingLoop(
  prisma: PrismaClient,
  intervalMs: number,
  config: OrderingConfig = {}
): { stop: () => void } {
  const engine = new OrderingEngine(prisma, config)
  let running = true
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const runLoop = async () => {
    if (!running) return

    try {
      await engine.computeRanks()
    } catch (error) {
      const logger = config.logger ?? defaultLogger
      logger.error('Ordering loop error:', error)
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

/**
 * Utility: Get sorted ranks for a sale (for API/display)
 */
export async function getSaleRankings(
  prisma: PrismaClient,
  saleId: string,
  options: { finalOnly?: boolean; limit?: number } = {}
): Promise<
  Array<{
    txid: string
    buyerAddrHash: string | null
    provisionalRank: number | null
    finalRank: number | null
    confirmations: number
    isWinner: boolean
  }>
> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) return []

  const where: {
    saleId: string
    validationStatus: { in: Array<'valid' | 'valid_fallback'> }
    accepted: true
    confirmations?: { gte: number }
  } = {
    saleId,
    validationStatus: { in: ['valid', 'valid_fallback'] },
    accepted: true,
  }

  if (options.finalOnly) {
    where.confirmations = { gte: sale.finalityDepth }
  }

  const attempts = await prisma.purchaseAttempt.findMany({
    where,
    orderBy: [
      { acceptingBlueScore: 'asc' },
      { txid: 'asc' },
    ],
    take: options.limit,
  })

  return attempts.map((a) => ({
    txid: a.txid,
    buyerAddrHash: a.buyerAddrHash,
    provisionalRank: a.provisionalRank,
    finalRank: a.finalRank,
    confirmations: a.confirmations,
    isWinner: a.finalRank !== null && a.finalRank <= sale.supplyTotal,
  }))
}
