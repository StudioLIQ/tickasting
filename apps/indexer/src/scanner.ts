/**
 * Treasury Scanner
 *
 * Polls for incoming transactions to treasury addresses of live sales.
 * Inserts new transactions into purchase_attempts table.
 */

import type { PrismaClient, Sale } from '@prisma/client'
import type { KaspaAdapter, KaspaTransaction } from '@ghostpass/shared'

export interface ScannerConfig {
  /** Batch size for fetching transactions from adapter */
  fetchLimit?: number
  /** Logger instance (optional) */
  logger?: {
    info: (msg: string, data?: unknown) => void
    error: (msg: string, data?: unknown) => void
    debug: (msg: string, data?: unknown) => void
  }
}

export interface ScanResult {
  saleId: string
  treasuryAddress: string
  newTxCount: number
  errors: string[]
}

const defaultLogger = {
  info: (msg: string, data?: unknown) => console.log(`[Scanner] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[Scanner] ${msg}`, data ?? ''),
  debug: (msg: string, data?: unknown) => console.log(`[Scanner:debug] ${msg}`, data ?? ''),
}

/**
 * Scans treasury addresses for live sales and inserts new transactions
 */
export class TreasuryScanner {
  private readonly prisma: PrismaClient
  private readonly adapter: KaspaAdapter
  private readonly config: Required<ScannerConfig>

  constructor(prisma: PrismaClient, adapter: KaspaAdapter, config: ScannerConfig = {}) {
    this.prisma = prisma
    this.adapter = adapter
    this.config = {
      fetchLimit: config.fetchLimit ?? 100,
      logger: config.logger ?? defaultLogger,
    }
  }

  /**
   * Run a single scan cycle for all live sales
   */
  async scan(): Promise<ScanResult[]> {
    const results: ScanResult[] = []

    // 1. Get all live sales
    const liveSales = await this.getLiveSales()

    if (liveSales.length === 0) {
      this.config.logger.debug('No live sales to scan')
      return results
    }

    this.config.logger.info(`Scanning ${liveSales.length} live sale(s)`)

    // 2. Process each sale
    for (const sale of liveSales) {
      const result = await this.scanSale(sale)
      results.push(result)
    }

    return results
  }

  /**
   * Get all sales with status = 'live'
   */
  private async getLiveSales(): Promise<Sale[]> {
    return this.prisma.sale.findMany({
      where: { status: 'live' },
    })
  }

  /**
   * Scan a single sale for new transactions
   */
  private async scanSale(sale: Sale): Promise<ScanResult> {
    const result: ScanResult = {
      saleId: sale.id,
      treasuryAddress: sale.treasuryAddress,
      newTxCount: 0,
      errors: [],
    }

    try {
      // 1. Fetch transactions from adapter
      const txResult = await this.adapter.getAddressTransactions(sale.treasuryAddress, {
        limit: this.config.fetchLimit,
        includePayload: true,
      })

      if (txResult.transactions.length === 0) {
        this.config.logger.debug(`No transactions found for sale ${sale.id}`)
        return result
      }

      // 2. Get existing txids for this sale (to filter duplicates)
      const existingTxids = await this.getExistingTxids(sale.id)
      const existingSet = new Set(existingTxids)

      // 3. Filter new transactions
      const newTxs = txResult.transactions.filter((tx) => !existingSet.has(tx.txid))

      if (newTxs.length === 0) {
        this.config.logger.debug(`No new transactions for sale ${sale.id}`)
        return result
      }

      // 4. Insert new transactions
      await this.insertPurchaseAttempts(sale.id, newTxs)
      result.newTxCount = newTxs.length

      this.config.logger.info(`Inserted ${newTxs.length} new tx(s) for sale ${sale.id}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      result.errors.push(errorMsg)
      this.config.logger.error(`Error scanning sale ${sale.id}: ${errorMsg}`)
    }

    return result
  }

  /**
   * Get existing txids for a sale
   */
  private async getExistingTxids(saleId: string): Promise<string[]> {
    const attempts = await this.prisma.purchaseAttempt.findMany({
      where: { saleId },
      select: { txid: true },
    })
    return attempts.map((a) => a.txid)
  }

  /**
   * Insert new purchase attempts
   */
  private async insertPurchaseAttempts(saleId: string, txs: KaspaTransaction[]): Promise<void> {
    const data = txs.map((tx) => ({
      saleId,
      txid: tx.txid,
      detectedAt: new Date(),
      validationStatus: 'pending' as const,
      payloadHex: tx.payload ?? null,
      accepted: tx.isAccepted,
      acceptingBlockHash: tx.acceptingBlockHash ?? null,
      confirmations: tx.confirmations,
    }))

    // Use createMany with skipDuplicates to handle race conditions
    await this.prisma.purchaseAttempt.createMany({
      data,
      skipDuplicates: true,
    })
  }
}

/**
 * Create and start a scanner loop
 */
export function createScannerLoop(
  prisma: PrismaClient,
  adapter: KaspaAdapter,
  intervalMs: number,
  config: ScannerConfig = {}
): { stop: () => void } {
  const scanner = new TreasuryScanner(prisma, adapter, config)
  let running = true
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const runLoop = async () => {
    if (!running) return

    try {
      await scanner.scan()
    } catch (error) {
      const logger = config.logger ?? defaultLogger
      logger.error('Scanner loop error:', error)
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
