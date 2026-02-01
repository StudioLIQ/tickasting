import { describe, it, expect } from 'vitest'
import {
  encodePayload,
  decodePayload,
  PayloadError,
  MAGIC,
  PAYLOAD_VERSION,
  POW_ALGO_SHA256,
  PAYLOAD_LENGTH,
  type PayloadV1,
} from './payload.js'

describe('Payload v1', () => {
  const samplePayload: PayloadV1 = {
    magic: MAGIC,
    version: PAYLOAD_VERSION,
    saleId: '550e8400-e29b-41d4-a716-446655440000',
    buyerAddrHash: '0123456789abcdef0123456789abcdef01234567',
    clientTimeMs: 1706800000000n,
    powAlgo: POW_ALGO_SHA256,
    powDifficulty: 18,
    powNonce: 123456789n,
  }

  describe('encodePayload', () => {
    it('should encode payload to hex string of correct length', () => {
      const hex = encodePayload(samplePayload)
      expect(hex.length).toBe(PAYLOAD_LENGTH * 2) // 59 bytes * 2
    })

    it('should start with magic bytes', () => {
      const hex = encodePayload(samplePayload)
      const magicHex = Buffer.from(MAGIC).toString('hex')
      expect(hex.startsWith(magicHex)).toBe(true)
    })

    it('should throw on invalid buyerAddrHash length', () => {
      const invalidPayload = { ...samplePayload, buyerAddrHash: '0123' }
      expect(() => encodePayload(invalidPayload)).toThrow(PayloadError)
    })
  })

  describe('decodePayload', () => {
    it('should decode encoded payload correctly (roundtrip)', () => {
      const hex = encodePayload(samplePayload)
      const decoded = decodePayload(hex)

      expect(decoded.magic).toBe(samplePayload.magic)
      expect(decoded.version).toBe(samplePayload.version)
      expect(decoded.saleId).toBe(samplePayload.saleId)
      expect(decoded.buyerAddrHash).toBe(samplePayload.buyerAddrHash)
      expect(decoded.clientTimeMs).toBe(samplePayload.clientTimeMs)
      expect(decoded.powAlgo).toBe(samplePayload.powAlgo)
      expect(decoded.powDifficulty).toBe(samplePayload.powDifficulty)
      expect(decoded.powNonce).toBe(samplePayload.powNonce)
    })

    it('should throw on invalid length', () => {
      expect(() => decodePayload('1234')).toThrow(PayloadError)
    })

    it('should throw on invalid magic', () => {
      const hex = encodePayload(samplePayload)
      const invalidHex = 'deadbeef' + hex.slice(8) // Replace magic
      expect(() => decodePayload(invalidHex)).toThrow(PayloadError)
    })
  })

  describe('edge cases', () => {
    it('should handle zero values', () => {
      const zeroPayload: PayloadV1 = {
        magic: MAGIC,
        version: PAYLOAD_VERSION,
        saleId: '00000000-0000-0000-0000-000000000000',
        buyerAddrHash: '0000000000000000000000000000000000000000',
        clientTimeMs: 0n,
        powAlgo: POW_ALGO_SHA256,
        powDifficulty: 0,
        powNonce: 0n,
      }

      const hex = encodePayload(zeroPayload)
      const decoded = decodePayload(hex)

      expect(decoded.saleId).toBe(zeroPayload.saleId)
      expect(decoded.clientTimeMs).toBe(0n)
      expect(decoded.powNonce).toBe(0n)
    })

    it('should handle max uint64 values', () => {
      const maxPayload: PayloadV1 = {
        ...samplePayload,
        clientTimeMs: BigInt('18446744073709551615'), // max uint64
        powNonce: BigInt('18446744073709551615'),
      }

      const hex = encodePayload(maxPayload)
      const decoded = decodePayload(hex)

      expect(decoded.clientTimeMs).toBe(maxPayload.clientTimeMs)
      expect(decoded.powNonce).toBe(maxPayload.powNonce)
    })
  })
})
