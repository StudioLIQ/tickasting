/**
 * Allocation Snapshot Generator
 *
 * Generates allocation.json for finalized sales containing:
 * - Sale metadata
 * - Ordering rules
 * - Winners list
 * - Verification data
 */

import type { PrismaClient, Sale, PurchaseAttempt } from '@prisma/client'

export interface AllocationWinner {
  finalRank: number
  txid: string
  acceptingBlockHash: string | null
  acceptingBlueScore: string | null
  confirmations: number
  buyerAddrHash: string | null
  payloadHex: string | null
}

export interface AllocationSnapshot {
  saleId: string
  network: string
  treasuryAddress: string
  ticketPriceSompi: string
  supplyTotal: number
  finalityDepth: number
  pow: {
    algo: string
    difficulty: number
  }
  orderingRule: {
    primary: string
    tiebreaker: string
  }
  generatedAt: string
  totalAttempts: number
  validAttempts: number
  winners: AllocationWinner[]
  losersCount: number
}

export interface AllocationConfig {
  logger?: {
    info: (msg: string, data?: unknown) => void
    error: (msg: string, data?: unknown) => void
  }
}

const defaultLogger = {
  info: (msg: string, data?: unknown) => console.log(`[Allocation] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[Allocation] ${msg}`, data ?? ''),
}

/**
 * Generate allocation snapshot for a sale
 */
export async function generateAllocation(
  prisma: PrismaClient,
  saleId: string,
  config: AllocationConfig = {}
): Promise<AllocationSnapshot | null> {
  const logger = config.logger ?? defaultLogger

  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) {
    logger.error(`Sale not found: ${saleId}`)
    return null
  }

  // Get all valid, accepted, final attempts
  const attempts = await prisma.purchaseAttempt.findMany({
    where: {
      saleId,
      validationStatus: 'valid',
      accepted: true,
      confirmations: { gte: sale.finalityDepth },
    },
    orderBy: [{ acceptingBlueScore: 'asc' }, { txid: 'asc' }],
  })

  // Get total counts
  const [totalAttempts, validAttempts] = await Promise.all([
    prisma.purchaseAttempt.count({ where: { saleId } }),
    prisma.purchaseAttempt.count({ where: { saleId, validationStatus: 'valid' } }),
  ])

  // Build winners list (up to supplyTotal)
  const winners: AllocationWinner[] = attempts.slice(0, sale.supplyTotal).map((a, i) => ({
    finalRank: i + 1,
    txid: a.txid,
    acceptingBlockHash: a.acceptingBlockHash,
    acceptingBlueScore: a.acceptingBlueScore?.toString() ?? null,
    confirmations: a.confirmations,
    buyerAddrHash: a.buyerAddrHash,
    payloadHex: a.payloadHex,
  }))

  const losersCount = Math.max(0, attempts.length - sale.supplyTotal)

  const snapshot: AllocationSnapshot = {
    saleId: sale.id,
    network: sale.network,
    treasuryAddress: sale.treasuryAddress,
    ticketPriceSompi: sale.ticketPriceSompi.toString(),
    supplyTotal: sale.supplyTotal,
    finalityDepth: sale.finalityDepth,
    pow: {
      algo: 'sha256',
      difficulty: sale.powDifficulty,
    },
    orderingRule: {
      primary: 'acceptingBlockHash.blueScore asc',
      tiebreaker: 'txid lexicographic asc',
    },
    generatedAt: new Date().toISOString(),
    totalAttempts,
    validAttempts,
    winners,
    losersCount,
  }

  logger.info(`Generated allocation for sale ${saleId}: ${winners.length} winners`)

  return snapshot
}

/**
 * Check if sale is ready for finalization
 */
export async function isSaleReadyForFinalization(
  prisma: PrismaClient,
  saleId: string
): Promise<boolean> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) return false

  // Must be in finalizing status
  if (sale.status !== 'finalizing') return false

  // Check if end time has passed (if set)
  if (sale.endAt && sale.endAt > new Date()) return false

  // Check if we have enough final attempts
  const finalCount = await prisma.purchaseAttempt.count({
    where: {
      saleId,
      validationStatus: 'valid',
      accepted: true,
      confirmations: { gte: sale.finalityDepth },
    },
  })

  // Ready if we have at least supply_total final attempts OR sale has ended
  return finalCount >= sale.supplyTotal || (sale.endAt !== null && sale.endAt <= new Date())
}

/**
 * Finalize a sale and generate allocation
 */
export async function finalizeSale(
  prisma: PrismaClient,
  saleId: string,
  config: AllocationConfig = {}
): Promise<AllocationSnapshot | null> {
  const logger = config.logger ?? defaultLogger

  const snapshot = await generateAllocation(prisma, saleId, config)
  if (!snapshot) return null

  // Update sale to finalized status
  await prisma.sale.update({
    where: { id: saleId },
    data: {
      status: 'finalized',
      updatedAt: new Date(),
    },
  })

  logger.info(`Sale ${saleId} finalized with ${snapshot.winners.length} winners`)

  return snapshot
}
