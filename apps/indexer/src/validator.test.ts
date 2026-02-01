import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient, Sale, PurchaseAttempt } from '@prisma/client'
import type { KaspaAdapter, KaspaTransaction } from '@ghostpass/shared'
import { encodePayload, solvePow, computeBuyerAddrHash } from '@ghostpass/shared'
import { PurchaseValidator, validatePayloadOnly } from './validator.js'

// Mock logger
const silentLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

// Test sale
const testSale: Sale = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  eventId: 'event-001',
  network: 'testnet',
  treasuryAddress: 'kaspa:qz7ulu4c25dh7fzec9zjyrmlhnkzrg5whcca6ued2ryvmqtwkuu9vuvvlg67a',
  ticketPriceSompi: BigInt(1000000000), // 10 KAS
  supplyTotal: 100,
  maxPerAddress: null,
  powDifficulty: 8, // Low difficulty for tests
  finalityDepth: 30,
  startAt: new Date(),
  endAt: new Date(Date.now() + 86400000),
  status: 'live',
  merkleRoot: null,
  commitTxid: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// Generate valid payload for tests
function generateValidPayload(sale: Sale): { payloadHex: string; buyerAddrHash: string; nonce: bigint } {
  const buyerAddress = 'kaspa:qz7ulu4c25dh7fzec9zjyrmlhnkzrg5whcca6ued2ryvmqtwkuu9vuvvlg67a'
  const buyerAddrHash = computeBuyerAddrHash(buyerAddress)

  // Solve PoW
  const powResult = solvePow({
    saleId: sale.id,
    buyerAddrHash,
    difficulty: sale.powDifficulty,
  })

  const payloadHex = encodePayload({
    magic: 'GPS1',
    version: 0x01,
    saleId: sale.id,
    buyerAddrHash,
    clientTimeMs: BigInt(Date.now()),
    powAlgo: 0x01,
    powDifficulty: sale.powDifficulty,
    powNonce: powResult.nonce,
  })

  return { payloadHex, buyerAddrHash, nonce: powResult.nonce }
}

describe('PurchaseValidator', () => {
  let mockPrisma: {
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

  it('should return empty when no pending attempts', async () => {
    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([])

    const validator = new PurchaseValidator(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await validator.validatePending()

    expect(results).toHaveLength(0)
  })

  it('should validate valid attempt with correct payload', async () => {
    const { payloadHex, buyerAddrHash } = generateValidPayload(testSale)

    const attempt: PurchaseAttempt & { sale: Sale } = {
      id: 'attempt-001',
      saleId: testSale.id,
      txid: 'tx-001',
      detectedAt: new Date(),
      validationStatus: 'pending',
      invalidReason: null,
      payloadHex,
      buyerAddrHash: null,
      accepted: true,
      acceptingBlockHash: null,
      acceptingBlueScore: null,
      confirmations: 0,
      provisionalRank: null,
      finalRank: null,
      lastCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sale: testSale,
    }

    const mockTx: KaspaTransaction = {
      txid: 'tx-001',
      isAccepted: true,
      confirmations: 5,
      inputs: [],
      outputs: [
        {
          value: testSale.ticketPriceSompi,
          scriptPublicKey: { scriptPublicKey: 'script' },
          address: testSale.treasuryAddress,
        },
      ],
      payload: payloadHex,
    }

    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})
    mockAdapter.getTransactionDetails.mockResolvedValue(mockTx)

    const validator = new PurchaseValidator(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await validator.validatePending()

    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('valid')
    expect(results[0]!.buyerAddrHash).toBe(buyerAddrHash)
    expect(results[0]!.invalidReason).toBeNull()
  })

  it('should reject attempt with missing payload', async () => {
    const attempt: PurchaseAttempt & { sale: Sale } = {
      id: 'attempt-001',
      saleId: testSale.id,
      txid: 'tx-001',
      detectedAt: new Date(),
      validationStatus: 'pending',
      invalidReason: null,
      payloadHex: null,
      buyerAddrHash: null,
      accepted: true,
      acceptingBlockHash: null,
      acceptingBlueScore: null,
      confirmations: 0,
      provisionalRank: null,
      finalRank: null,
      lastCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sale: testSale,
    }

    const mockTx: KaspaTransaction = {
      txid: 'tx-001',
      isAccepted: true,
      confirmations: 5,
      inputs: [],
      outputs: [],
      // No payload
    }

    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})
    mockAdapter.getTransactionDetails.mockResolvedValue(mockTx)

    const validator = new PurchaseValidator(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await validator.validatePending()

    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('invalid_missing_payload')
  })

  it('should reject attempt with wrong sale ID', async () => {
    const { payloadHex } = generateValidPayload(testSale)

    // Create attempt with different sale
    const otherSale = { ...testSale, id: 'different-sale-id-000000000000000' }

    const attempt: PurchaseAttempt & { sale: Sale } = {
      id: 'attempt-001',
      saleId: otherSale.id,
      txid: 'tx-001',
      detectedAt: new Date(),
      validationStatus: 'pending',
      invalidReason: null,
      payloadHex,
      buyerAddrHash: null,
      accepted: true,
      acceptingBlockHash: null,
      acceptingBlueScore: null,
      confirmations: 0,
      provisionalRank: null,
      finalRank: null,
      lastCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sale: otherSale,
    }

    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const validator = new PurchaseValidator(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await validator.validatePending()

    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('invalid_wrong_sale')
  })

  it('should reject attempt with invalid PoW', async () => {
    const buyerAddress = 'kaspa:qtest123'
    const buyerAddrHash = computeBuyerAddrHash(buyerAddress)

    // Create payload with wrong nonce (PoW will fail)
    const payloadHex = encodePayload({
      magic: 'GPS1',
      version: 0x01,
      saleId: testSale.id,
      buyerAddrHash,
      clientTimeMs: BigInt(Date.now()),
      powAlgo: 0x01,
      powDifficulty: testSale.powDifficulty,
      powNonce: 12345n, // Wrong nonce
    })

    const attempt: PurchaseAttempt & { sale: Sale } = {
      id: 'attempt-001',
      saleId: testSale.id,
      txid: 'tx-001',
      detectedAt: new Date(),
      validationStatus: 'pending',
      invalidReason: null,
      payloadHex,
      buyerAddrHash: null,
      accepted: true,
      acceptingBlockHash: null,
      acceptingBlueScore: null,
      confirmations: 0,
      provisionalRank: null,
      finalRank: null,
      lastCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sale: testSale,
    }

    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const validator = new PurchaseValidator(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await validator.validatePending()

    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('invalid_pow')
  })

  it('should reject attempt with wrong amount', async () => {
    const { payloadHex } = generateValidPayload(testSale)

    const attempt: PurchaseAttempt & { sale: Sale } = {
      id: 'attempt-001',
      saleId: testSale.id,
      txid: 'tx-001',
      detectedAt: new Date(),
      validationStatus: 'pending',
      invalidReason: null,
      payloadHex,
      buyerAddrHash: null,
      accepted: true,
      acceptingBlockHash: null,
      acceptingBlueScore: null,
      confirmations: 0,
      provisionalRank: null,
      finalRank: null,
      lastCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sale: testSale,
    }

    const mockTx: KaspaTransaction = {
      txid: 'tx-001',
      isAccepted: true,
      confirmations: 5,
      inputs: [],
      outputs: [
        {
          value: BigInt(500000000), // Wrong amount (5 KAS instead of 10)
          scriptPublicKey: { scriptPublicKey: 'script' },
          address: testSale.treasuryAddress,
        },
      ],
      payload: payloadHex,
    }

    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})
    mockAdapter.getTransactionDetails.mockResolvedValue(mockTx)

    const validator = new PurchaseValidator(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await validator.validatePending()

    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('invalid_wrong_amount')
  })

  it('should reject attempt with invalid magic', async () => {
    const buyerAddress = 'kaspa:qtest123'
    const buyerAddrHash = computeBuyerAddrHash(buyerAddress)

    // Manually create payload with wrong magic
    // GPS1 in hex is 47505331, we'll use XXXX (58585858)
    const invalidPayload =
      '58585858' + // Wrong magic
      '01' + // version
      testSale.id.replace(/-/g, '') + // saleId
      buyerAddrHash + // buyerAddrHash
      '00000000000000ff' + // clientTimeMs
      '01' + // powAlgo
      '08' + // powDifficulty
      '0000000000000001' // powNonce

    const attempt: PurchaseAttempt & { sale: Sale } = {
      id: 'attempt-001',
      saleId: testSale.id,
      txid: 'tx-001',
      detectedAt: new Date(),
      validationStatus: 'pending',
      invalidReason: null,
      payloadHex: invalidPayload,
      buyerAddrHash: null,
      accepted: true,
      acceptingBlockHash: null,
      acceptingBlueScore: null,
      confirmations: 0,
      provisionalRank: null,
      finalRank: null,
      lastCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      sale: testSale,
    }

    mockPrisma.purchaseAttempt.findMany.mockResolvedValue([attempt])
    mockPrisma.purchaseAttempt.update.mockResolvedValue({})

    const validator = new PurchaseValidator(
      mockPrisma as unknown as PrismaClient,
      mockAdapter as unknown as KaspaAdapter,
      { logger: silentLogger }
    )

    const results = await validator.validatePending()

    expect(results).toHaveLength(1)
    expect(results[0]!.status).toBe('invalid_bad_payload')
    expect(results[0]!.invalidReason).toContain('magic')
  })
})

describe('validatePayloadOnly', () => {
  it('should validate correct payload', () => {
    const { payloadHex, buyerAddrHash } = generateValidPayload(testSale)

    const result = validatePayloadOnly(payloadHex, testSale.id, testSale.powDifficulty)

    expect(result.valid).toBe(true)
    expect(result.buyerAddrHash).toBe(buyerAddrHash)
  })

  it('should reject wrong saleId', () => {
    const { payloadHex } = generateValidPayload(testSale)

    const result = validatePayloadOnly(payloadHex, 'wrong-sale-id-00000000000000000', testSale.powDifficulty)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Sale ID')
  })

  it('should reject invalid payload length', () => {
    const result = validatePayloadOnly('abcd', testSale.id, testSale.powDifficulty)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('length')
  })
})
