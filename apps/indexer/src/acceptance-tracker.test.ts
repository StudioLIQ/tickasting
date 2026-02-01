import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient, Sale, PurchaseAttempt } from '@prisma/client'
import type { KaspaAdapter, TransactionAcceptance, KaspaBlock } from '@ghostpass/shared'
import { AcceptanceTracker } from './acceptance-tracker.js'

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
  supplyTotal: 100,
  maxPerAddress: null,
  powDifficulty: 18,
  finalityDepth: 30,
  fallbackEnabled: false,
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
    accepted: false,
    acceptingBlockHash: null,
    acceptingBlueScore: null,
    confirmations: 0,
    provisionalRank: null,
    finalRank: null,
    lastCheckedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('AcceptanceTracker', () => {
  let mockPrisma: {
    sale: { findMany: ReturnType<typeof vi.fn> }
    purchaseAttempt: {
      findMany: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
  }
  let mockAdapter: {
    getAddressTransactions: ReturnType<typeof vi.fn>
    getTransactionsAcceptance: ReturnType<typeof vi.fn>
    getTransactionDetails: ReturnType<typeof vi.fn>
    getBlockDetails: ReturnType<typeof vi.fn>
    getNetworkInfo: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockPrisma = {
      sale: {
        findMany: vi.fn(),
      },
      purchaseAttempt: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
    }

    mockAdapter = {
      getAddressTransactions: vi.fn(),
      getTransactionsAcceptance: vi.fn(),
      getTransactionDetails: vi.fn(),
      getBlockDetails: vi.fn(),
      getNetworkInfo: vi.fn(),
    }
  })

  it('should return empty when no active sales', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([])

    const tracker = new AcceptanceTracker(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await tracker.track()

    expect(results).toHaveLength(0)
    expect(mockAdapter.getTransactionsAcceptance).not.toHaveBeenCalled()
  })

  it('should track acceptance for valid attempts', async () => {
    const attempt1 = mockAttempt('attempt-001', 'tx-001')
    const attempt2 = mockAttempt('attempt-002', 'tx-002')

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt1, attempt2])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const acceptanceData: TransactionAcceptance[] = [
      { txid: 'tx-001', isAccepted: true, confirmations: 5, acceptingBlockHash: 'block-001' },
      { txid: 'tx-002', isAccepted: true, confirmations: 10, acceptingBlockHash: 'block-002' },
    ]
    mockAdapter.getTransactionsAcceptance.mockResolvedValue(acceptanceData)

    const mockBlock: KaspaBlock = {
      hash: 'block-001',
      blueScore: BigInt(12345),
      timestamp: Date.now(),
      parentHashes: [],
    }
    mockAdapter.getBlockDetails.mockResolvedValue(mockBlock)

    const tracker = new AcceptanceTracker(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await tracker.track()

    expect(results).toHaveLength(1)
    expect(results[0]!.saleId).toBe('sale-001')
    expect(results[0]!.updatedCount).toBe(2)
    expect(results[0]!.newlyAccepted).toBe(2)

    // Verify updates
    expect(mockPrisma.purchaseAttempt.update).toHaveBeenCalledTimes(2)
    expect(mockPrisma.purchaseAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-001' },
      data: expect.objectContaining({
        accepted: true,
        confirmations: 5,
        acceptingBlockHash: 'block-001',
        acceptingBlueScore: BigInt(12345),
      }),
    })
  })

  it('should track newly final attempts', async () => {
    const attempt = mockAttempt('attempt-001', 'tx-001', {
      accepted: true,
      confirmations: 25, // Below finality depth of 30
    })

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const acceptanceData: TransactionAcceptance[] = [
      { txid: 'tx-001', isAccepted: true, confirmations: 35 }, // Now final
    ]
    mockAdapter.getTransactionsAcceptance.mockResolvedValue(acceptanceData)

    const tracker = new AcceptanceTracker(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await tracker.track()

    expect(results).toHaveLength(1)
    expect(results[0]!.newlyFinal).toBe(1)
    expect(results[0]!.newlyAccepted).toBe(0) // Was already accepted
  })

  it('should not track already final attempts', async () => {
    // This attempt is already final (confirmations >= finalityDepth)
    // We don't need to create it since the query should filter it out

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    // findMany should return empty because of the query filter
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([])

    const tracker = new AcceptanceTracker(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await tracker.track()

    expect(results).toHaveLength(1)
    expect(results[0]!.updatedCount).toBe(0)
    expect(mockAdapter.getTransactionsAcceptance).not.toHaveBeenCalled()
  })

  it('should handle API errors gracefully', async () => {
    const attempt = mockAttempt('attempt-001', 'tx-001')

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockAdapter.getTransactionsAcceptance.mockRejectedValue(new Error('API timeout'))

    const tracker = new AcceptanceTracker(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await tracker.track()

    expect(results).toHaveLength(1)
    expect(results[0]!.errors).toContain('API timeout')
    expect(results[0]!.updatedCount).toBe(0)
  })

  it('should batch large number of attempts', async () => {
    // Create 150 attempts (more than default batch size of 100)
    const attempts = Array.from({ length: 150 }, (_, i) =>
      mockAttempt(`attempt-${i}`, `tx-${i}`)
    )

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue(attempts)
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    // Mock acceptance for all
    mockAdapter.getTransactionsAcceptance.mockImplementation((txids: string[]) => {
      return Promise.resolve(
        txids.map((txid) => ({
          txid,
          isAccepted: true,
          confirmations: 5,
        }))
      )
    })

    const tracker = new AcceptanceTracker(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger, batchSize: 100 }
    )

    const results = await tracker.track()

    // Should have called getTransactionsAcceptance twice (100 + 50)
    expect(mockAdapter.getTransactionsAcceptance).toHaveBeenCalledTimes(2)
    expect(results[0]!.updatedCount).toBe(150)
  })

  it('should handle multiple active sales', async () => {
    const sale2 = { ...testSale, id: 'sale-002' }
    const attempt1 = mockAttempt('attempt-001', 'tx-001', { saleId: 'sale-001' })
    const attempt2 = mockAttempt('attempt-002', 'tx-002', { saleId: 'sale-002' })

    mockPrisma.sale.findMany.mockResolvedValue([testSale, sale2])
    mockPrisma.purchaseAttempt.findMany
      .mockResolvedValueOnce([attempt1])
      .mockResolvedValueOnce([attempt2])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    mockAdapter.getTransactionsAcceptance.mockResolvedValue([
      { txid: 'tx-001', isAccepted: true, confirmations: 5 },
      { txid: 'tx-002', isAccepted: true, confirmations: 10 },
    ])

    const tracker = new AcceptanceTracker(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await tracker.track()

    expect(results).toHaveLength(2)
    expect(results[0]!.saleId).toBe('sale-001')
    expect(results[1]!.saleId).toBe('sale-002')
  })

  it('should handle missing acceptance data', async () => {
    const attempt = mockAttempt('attempt-001', 'tx-001')

    mockPrisma.sale.findMany.mockResolvedValue([testSale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    // Return empty acceptance data
    mockAdapter.getTransactionsAcceptance.mockResolvedValue([])

    const tracker = new AcceptanceTracker(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await tracker.track()

    expect(results).toHaveLength(1)
    expect(results[0]!.updatedCount).toBe(0) // No updates because no acceptance data
    expect(mockPrisma.purchaseAttempt.update).not.toHaveBeenCalled()
  })
})
