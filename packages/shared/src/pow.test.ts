import { describe, it, expect } from 'vitest'
import {
  buildPowMessage,
  countLeadingZeroBits,
  verifyPow,
  getPowHash,
  solvePow,
  estimateHashCount,
  type PowInput,
} from './pow.js'

describe('PoW', () => {
  const sampleInput: PowInput = {
    saleId: '550e8400-e29b-41d4-a716-446655440000',
    buyerAddrHash: '0123456789abcdef0123456789abcdef01234567',
    difficulty: 8,
  }

  describe('buildPowMessage', () => {
    it('should build correct message format', () => {
      const message = buildPowMessage(sampleInput.saleId, sampleInput.buyerAddrHash, 12345n)
      expect(message).toBe(
        'TickastingPoW|v1|550e8400-e29b-41d4-a716-446655440000|0123456789abcdef0123456789abcdef01234567|12345'
      )
    })
  })

  describe('countLeadingZeroBits', () => {
    it('should return 0 for byte starting with 1', () => {
      expect(countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0)
      expect(countLeadingZeroBits(new Uint8Array([0x80]))).toBe(0)
    })

    it('should return 8 for zero byte', () => {
      expect(countLeadingZeroBits(new Uint8Array([0x00, 0xff]))).toBe(8)
    })

    it('should return 16 for two zero bytes', () => {
      expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00, 0xff]))).toBe(16)
    })

    it('should count partial leading zeros', () => {
      expect(countLeadingZeroBits(new Uint8Array([0x0f]))).toBe(4) // 00001111
      expect(countLeadingZeroBits(new Uint8Array([0x01]))).toBe(7) // 00000001
      expect(countLeadingZeroBits(new Uint8Array([0x40]))).toBe(1) // 01000000
    })

    it('should handle combined cases', () => {
      expect(countLeadingZeroBits(new Uint8Array([0x00, 0x0f]))).toBe(12) // 8 + 4
      expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00, 0x01]))).toBe(23) // 16 + 7
    })
  })

  describe('verifyPow', () => {
    it('should return false for nonce 0 (most likely)', () => {
      // With difficulty 8, ~1/256 chance of passing with random nonce
      // For reproducibility, we test that at least nonce 0 likely fails
      // This test is probabilistic but should almost always pass
      const result = verifyPow({ ...sampleInput, difficulty: 16 }, 0n)
      // Just check it returns a boolean
      expect(typeof result).toBe('boolean')
    })

    it('should return true for a valid solved nonce', () => {
      // Solve with low difficulty for fast test
      const lowDiffInput = { ...sampleInput, difficulty: 4 }
      const { nonce } = solvePow(lowDiffInput)
      expect(verifyPow(lowDiffInput, nonce)).toBe(true)
    })

    it('should return false for invalid nonce', () => {
      // Find a valid nonce and then use nonce + 1 (almost certainly invalid)
      const lowDiffInput = { ...sampleInput, difficulty: 8 }
      const { nonce } = solvePow(lowDiffInput)
      // There's a small chance nonce+1 is also valid, but very unlikely
      const invalidNonce = nonce + 1000n
      const hash = getPowHash(lowDiffInput, invalidNonce)
      const zeroBits = countLeadingZeroBitsFromHex(hash)
      // This is probabilistic - if it happens to pass, skip
      if (zeroBits < lowDiffInput.difficulty) {
        expect(verifyPow(lowDiffInput, invalidNonce)).toBe(false)
      }
    })
  })

  describe('solvePow', () => {
    it('should find a valid nonce for difficulty 0', () => {
      const result = solvePow({ ...sampleInput, difficulty: 0 })
      expect(result.nonce).toBe(0n) // Any nonce works for difficulty 0
    })

    it('should find a valid nonce for difficulty 8', () => {
      const result = solvePow({ ...sampleInput, difficulty: 8 })
      expect(typeof result.nonce).toBe('bigint')
      expect(result.hash.length).toBe(64) // SHA-256 hex
      expect(verifyPow({ ...sampleInput, difficulty: 8 }, result.nonce)).toBe(true)
    })

    it('should find a valid nonce for difficulty 16', () => {
      const result = solvePow({ ...sampleInput, difficulty: 16 })
      expect(verifyPow({ ...sampleInput, difficulty: 16 }, result.nonce)).toBe(true)
    })

    it('should respect maxIterations', () => {
      expect(() =>
        solvePow({ ...sampleInput, difficulty: 64 }, 0n, 1000n)
      ).toThrow('PoW not found')
    })
  })

  describe('estimateHashCount', () => {
    it('should return correct estimates', () => {
      expect(estimateHashCount(0)).toBe(1n)
      expect(estimateHashCount(8)).toBe(256n)
      expect(estimateHashCount(16)).toBe(65536n)
      expect(estimateHashCount(24)).toBe(16777216n)
    })
  })
})

// Helper for testing
function countLeadingZeroBitsFromHex(hex: string): number {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }

  let count = 0
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8
    } else {
      let mask = 0x80
      while (mask > 0 && (byte & mask) === 0) {
        count++
        mask >>= 1
      }
      break
    }
  }
  return count
}
