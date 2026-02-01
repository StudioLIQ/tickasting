import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient, Sale, PurchaseAttempt } from '@prisma/client'
import { OrderingEngine } from './ordering.js'

// Mock logger
const silentLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

// Test sale
const testSale: Sale = {
  id: 'sale-001',
  eventId: 'event-001',
  network: 'testnet',
  treasuryAddress: 'kaspa:qtest123',
  ticketPriceSompi: BigInt(1000000000),
  supplyTotal: 2, // Only 2 winners
  maxPerAddress: null,
  powDifficulty: 18,
  finalityDepth: 30,
  startAt: new Date(),
  endAt: new Date(Date.now() + 86400000),
  status: 'live',
  merkleRoot: null,
  commitTxid: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// Helper to create mock attempt
function mockAttempt(
  id: string,
  txid: string,
  blueScore: bigint,
  confirmations: number,
  overrides: Partial<PurchaseAttempt> = {}
): PurchaseAttempt {
  return {
    id,
    saleId: testSale.id,
    txid,
    detectedAt: new Date(),
    validationStatus: 'valid',
    invalidReason: null,
    payloadHex: 'abc123',
    buyerAddrHash: 'hash123',
    accepted: true,
    acceptingBlockHash: 'block-hash',
    acceptingBlueScore: blueScore,
    confirmations,
    provisionalRank: null,
    finalRank: null,
    lastCheckedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('OrderingEngine', () => {
  let mockPrisma: {
    sale: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }
    purchaseAttempt: {
      findMany: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    $transaction: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockPrisma = {
      sale: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      purchaseAttempt: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((fn) => fn(mockPrisma)),
    }
  })

  it('should return empty when no active sales', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([])

    const engine = new OrderingEngine(
      mockPrisma as unknown as PrismaClient,
      { logger: silentLogger }
    )

    const results = await engine.computeRanks()

    expect(results).toHaveLength(0)
  })

  it('should compute provisional ranks sorted by blueScore then txid', async () => {
    // Create attempts with different blueScores
    const attempt1 = mockAttempt('a1', 'tx-001', BigInt(100), 5) // blueScore 100
    const attempt2 = mockAttempt('a2', 'tx-002', BigInt(50), 10) // blueScore 50 (lower = earlier)
    const attempt3 = mockAttempt('a3', 'tx-003', BigInt(100), 15) // blueScore 100 (tie with tx-001)

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt1, attempt2, attempt3])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const engine = new OrderingEngine(
      mockPrisma as unknown as PrismaClient,
      { logger: silentLogger }
    )

    const results = await engine.computeRanks()

    expect(results).toHaveLength(1)
    expect(results[0]!.provisionalRanked).toBe(3)

    // Verify the order: tx-002 (blueScore 50), tx-001 (blueScore 100, lower txid), tx-003 (blueScore 100, higher txid)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates = mockPrisma.purchaseAttempt.update.mock.calls as any[]

    // Find provisional rank updates
    const provisionalUpdates = updates
      .filter((call) => 'provisionalRank' in call[0].data)
      .map((call) => ({
        id: call[0].where.id as string,
        rank: call[0].data.provisionalRank as number,
      }))
      .sort((a, b) => a.rank - b.rank)

    expect(provisionalUpdates).toEqual([
      { id: 'a2', rank: 1 }, // tx-002, blueScore 50
      { id: 'a1', rank: 2 }, // tx-001, blueScore 100, txid < tx-003
      { id: 'a3', rank: 3 }, // tx-003, blueScore 100, txid > tx-001
    ])
  })

  it('should compute final ranks only for confirmed attempts', async () => {
    // Only attempt2 and attempt3 have confirmations >= 30 (finalityDepth)
    const attempt1 = mockAttempt('a1', 'tx-001', BigInt(50), 10) // Not final
    const attempt2 = mockAttempt('a2', 'tx-002', BigInt(100), 35) // Final
    const attempt3 = mockAttempt('a3', 'tx-003', BigInt(75), 40) // Final

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt1, attempt2, attempt3])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const engine = new OrderingEngine(
      mockPrisma as unknown as PrismaClient,
      { logger: silentLogger }
    )

    const results = await engine.computeRanks()

    expect(results[0]!.provisionalRanked).toBe(3) // All get provisional ranks
    expect(results[0]!.finalRanked).toBe(2) // Only 2 get final ranks

    // Verify final rank order: tx-003 (blueScore 75), tx-002 (blueScore 100)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates = mockPrisma.purchaseAttempt.update.mock.calls as any[]
    const finalUpdates = updates
      .filter((call) => 'finalRank' in call[0].data)
      .map((call) => ({
        id: call[0].where.id as string,
        rank: call[0].data.finalRank as number,
      }))
      .sort((a, b) => a.rank - b.rank)

    expect(finalUpdates).toEqual([
      { id: 'a3', rank: 1 }, // tx-003, blueScore 75
      { id: 'a2', rank: 2 }, // tx-002, blueScore 100
    ])
  })

  it('should use txid as tie-breaker when blueScores are equal', async () => {
    const attempt1 = mockAttempt('a1', 'tx-bbb', BigInt(100), 35)
    const attempt2 = mockAttempt('a2', 'tx-aaa', BigInt(100), 35) // Same blueScore, lower txid
    const attempt3 = mockAttempt('a3', 'tx-ccc', BigInt(100), 35)

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt1, attempt2, attempt3])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const engine = new OrderingEngine(
      mockPrisma as unknown as PrismaClient,
      { logger: silentLogger }
    )

    await engine.computeRanks()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates = mockPrisma.purchaseAttempt.update.mock.calls as any[]
    const provisionalUpdates = updates
      .filter((call) => 'provisionalRank' in call[0].data)
      .map((call) => ({
        id: call[0].where.id as string,
        rank: call[0].data.provisionalRank as number,
      }))
      .sort((a, b) => a.rank - b.rank)

    // Lexicographic order: tx-aaa, tx-bbb, tx-ccc
    expect(provisionalUpdates).toEqual([
      { id: 'a2', rank: 1 }, // tx-aaa
      { id: 'a1', rank: 2 }, // tx-bbb
      { id: 'a3', rank: 3 }, // tx-ccc
    ])
  })

  it('should not update ranks if they have not changed', async () => {
    const attempt = mockAttempt('a1', 'tx-001', BigInt(100), 35, {
      provisionalRank: 1, // Already ranked
      finalRank: 1, // Already ranked
    })

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const engine = new OrderingEngine(
      mockPrisma as unknown as PrismaClient,
      { logger: silentLogger }
    )

    const results = await engine.computeRanks()

    expect(results[0]!.provisionalRanked).toBe(0)
    expect(results[0]!.finalRanked).toBe(0)
    expect(mockPrisma.purchaseAttempt.update).not.toHaveBeenCalled()
  })

  it('should handle attempts with null blueScore', async () => {
    const attempt1 = mockAttempt('a1', 'tx-001', BigInt(100), 35)
    const attempt2 = mockAttempt('a2', 'tx-002', BigInt(50), 35)
    const attempt3 = mockAttempt('a3', 'tx-003', BigInt(0), 35, {
      acceptingBlueScore: null, // Null blueScore should sort last
    })

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt1, attempt2, attempt3])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const engine = new OrderingEngine(
      mockPrisma as unknown as PrismaClient,
      { logger: silentLogger }
    )

    await engine.computeRanks()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates = mockPrisma.purchaseAttempt.update.mock.calls as any[]
    const provisionalUpdates = updates
      .filter((call) => 'provisionalRank' in call[0].data)
      .map((call) => ({
        id: call[0].where.id as string,
        rank: call[0].data.provisionalRank as number,
      }))
      .sort((a, b) => a.rank - b.rank)

    // tx-002 (50), tx-001 (100), tx-003 (null = last)
    expect(provisionalUpdates).toEqual([
      { id: 'a2', rank: 1 },
      { id: 'a1', rank: 2 },
      { id: 'a3', rank: 3 },
    ])
  })

  it('should handle database errors gracefully', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockRejectedValue(new Error('DB connection failed'))

    const engine = new OrderingEngine(
      mockPrisma as unknown as PrismaClient,
      { logger: silentLogger }
    )

    const results = await engine.computeRanks()

    expect(results).toHaveLength(1)
    expect(results[0]!.errors).toContain('DB connection failed')
  })

  it('should return empty when no valid accepted attempts', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([])

    const engine = new OrderingEngine(
      mockPrisma as unknown as PrismaClient,
      { logger: silentLogger }
    )

    const results = await engine.computeRanks()

    expect(results).toHaveLength(1)
    expect(results[0]!.provisionalRanked).toBe(0)
    expect(results[0]!.finalRanked).toBe(0)
  })
})
