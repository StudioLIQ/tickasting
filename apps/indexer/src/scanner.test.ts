import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient, Sale } from '@prisma/client'
import type { KaspaAdapter, KaspaTransaction, AddressTransactionsResult } from '@tickasting/shared'
import { TreasuryScanner } from './scanner.js'

// Mock logger that captures nothing
const silentLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

// Helper to create mock sale
function mockSale(overrides: Partial<Sale> = {}): Sale {
  return {
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
    ...overrides,
  }
}

// Helper to create mock transaction
function mockTx(txid: string, overrides: Partial<KaspaTransaction> = {}): KaspaTransaction {
  return {
    txid,
    isAccepted: true,
    confirmations: 5,
    inputs: [],
    outputs: [
      {
        value: BigInt(1000000000),
        scriptPublicKey: { scriptPublicKey: 'script123' },
        address: 'kaspa:qtest123',
      },
    ],
    payload: '544b53310100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    ...overrides,
  }
}

describe('TreasuryScanner', () => {
  let mockPrisma: {
    sale: { findMany: ReturnType<typeof vi.fn> }
    purchaseAttempt: {
      findMany: ReturnType<typeof vi.fn>
      createMany: ReturnType<typeof vi.fn>
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
        createMany: vi.fn(),
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

  it('should return empty results when no live sales', async () => {
    mockPrisma.sale.findMany.mockResolvedValue([])

    const scanner = new TreasuryScanner(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await scanner.scan()

    expect(results).toHaveLength(0)
    expect(mockAdapter.getAddressTransactions).not.toHaveBeenCalled()
  })

  it('should scan live sales and insert new transactions', async () => {
    const sale = mockSale()
    const tx1 = mockTx('tx-001')
    const tx2 = mockTx('tx-002')

    mockPrisma.sale.findMany.mockResolvedValue([sale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([])
    mockPrisma.purchaseAttempt.createMany.mockResolvedValue({ count: 2 })
    mockAdapter.getAddressTransactions.mockResolvedValue({
      transactions: [tx1, tx2],
      hasMore: false,
    } as AddressTransactionsResult)

    const scanner = new TreasuryScanner(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await scanner.scan()

    expect(results).toHaveLength(1)
    expect(results[0]!.saleId).toBe('sale-001')
    expect(results[0]!.newTxCount).toBe(2)
    expect(results[0]!.errors).toHaveLength(0)

    expect(mockPrisma.purchaseAttempt.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          saleId: 'sale-001',
          txid: 'tx-001',
          validationStatus: 'pending',
        }),
        expect.objectContaining({
          saleId: 'sale-001',
          txid: 'tx-002',
          validationStatus: 'pending',
        }),
      ]),
      skipDuplicates: true,
    })
  })

  it('should skip already existing transactions', async () => {
    const sale = mockSale()
    const tx1 = mockTx('tx-001')
    const tx2 = mockTx('tx-002')

    mockPrisma.sale.findMany.mockResolvedValue([sale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([{ txid: 'tx-001' }])
    mockPrisma.purchaseAttempt.createMany.mockResolvedValue({ count: 1 })
    mockAdapter.getAddressTransactions.mockResolvedValue({
      transactions: [tx1, tx2],
      hasMore: false,
    } as AddressTransactionsResult)

    const scanner = new TreasuryScanner(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await scanner.scan()

    expect(results).toHaveLength(1)
    expect(results[0]!.newTxCount).toBe(1)

    expect(mockPrisma.purchaseAttempt.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          saleId: 'sale-001',
          txid: 'tx-002',
        }),
      ],
      skipDuplicates: true,
    })
  })

  it('should handle adapter errors gracefully', async () => {
    const sale = mockSale()

    mockPrisma.sale.findMany.mockResolvedValue([sale])
    mockAdapter.getAddressTransactions.mockRejectedValue(new Error('API timeout'))

    const scanner = new TreasuryScanner(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await scanner.scan()

    expect(results).toHaveLength(1)
    expect(results[0]!.errors).toContain('API timeout')
    expect(results[0]!.newTxCount).toBe(0)
  })

  it('should scan multiple live sales', async () => {
    const sale1 = mockSale({ id: 'sale-001', treasuryAddress: 'kaspa:addr1' })
    const sale2 = mockSale({ id: 'sale-002', treasuryAddress: 'kaspa:addr2' })

    mockPrisma.sale.findMany.mockResolvedValue([sale1, sale2])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([])
    mockPrisma.purchaseAttempt.createMany.mockResolvedValue({ count: 1 })
    mockAdapter.getAddressTransactions
      .mockResolvedValueOnce({
        transactions: [mockTx('tx-001')],
        hasMore: false,
      })
      .mockResolvedValueOnce({
        transactions: [mockTx('tx-002')],
        hasMore: false,
      })

    const scanner = new TreasuryScanner(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await scanner.scan()

    expect(results).toHaveLength(2)
    expect(results[0]!.saleId).toBe('sale-001')
    expect(results[0]!.newTxCount).toBe(1)
    expect(results[1]!.saleId).toBe('sale-002')
    expect(results[1]!.newTxCount).toBe(1)
  })

  it('should preserve payload and acceptance data from adapter', async () => {
    const sale = mockSale()
    const tx = mockTx('tx-with-payload', {
      payload: 'abcd1234',
      isAccepted: true,
      acceptingBlockHash: 'block-hash-123',
      confirmations: 10,
    })

    mockPrisma.sale.findMany.mockResolvedValue([sale])
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([])
    mockPrisma.purchaseAttempt.createMany.mockResolvedValue({ count: 1 })
    mockAdapter.getAddressTransactions.mockResolvedValue({
      transactions: [tx],
      hasMore: false,
    })

    const scanner = new TreasuryScanner(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    await scanner.scan()

    expect(mockPrisma.purchaseAttempt.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          txid: 'tx-with-payload',
          payloadHex: 'abcd1234',
          accepted: true,
          acceptingBlockHash: 'block-hash-123',
          confirmations: 10,
        }),
      ],
      skipDuplicates: true,
    })
  })

  it('should return empty when no new transactions', async () => {
    const sale = mockSale()

    mockPrisma.sale.findMany.mockResolvedValue([sale])
    mockAdapter.getAddressTransactions.mockResolvedValue({
      transactions: [],
      hasMore: false,
    })

    const scanner = new TreasuryScanner(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await scanner.scan()

    expect(results).toHaveLength(1)
    expect(results[0]!.newTxCount).toBe(0)
    expect(mockPrisma.purchaseAttempt.createMany).not.toHaveBeenCalled()
  })
})
