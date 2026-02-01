import { describe, it, expect } from 'vitest'
import { computeBuyerAddrHash, verifyBuyerAddrHash } from './address.js'

describe('Address utilities', () => {
  const sampleAddress = 'kaspa:qz0ckdefn2xawf7gxvw6ztjm5w3s38hl2rq0t07l3uy4kskqxcqqjld7w5v6r'

  describe('computeBuyerAddrHash', () => {
    it('should return 40 character hex string', () => {
      const hash = computeBuyerAddrHash(sampleAddress)
      expect(hash.length).toBe(40)
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
    })

    it('should return consistent hash for same address', () => {
      const hash1 = computeBuyerAddrHash(sampleAddress)
      const hash2 = computeBuyerAddrHash(sampleAddress)
      expect(hash1).toBe(hash2)
    })

    it('should return different hash for different addresses', () => {
      const hash1 = computeBuyerAddrHash(sampleAddress)
      const hash2 = computeBuyerAddrHash('kaspa:qz0ckdefn2xawf7gxvw6ztjm5w3s38hl2rq0t07l3uy4kskqxcqqjld7w5v6s')
      expect(hash1).not.toBe(hash2)
    })
  })

  describe('verifyBuyerAddrHash', () => {
    it('should return true for matching address and hash', () => {
      const hash = computeBuyerAddrHash(sampleAddress)
      expect(verifyBuyerAddrHash(sampleAddress, hash)).toBe(true)
    })

    it('should return false for non-matching hash', () => {
      const wrongHash = '0000000000000000000000000000000000000000'
      expect(verifyBuyerAddrHash(sampleAddress, wrongHash)).toBe(false)
    })

    it('should be case-insensitive for hash comparison', () => {
      const hash = computeBuyerAddrHash(sampleAddress)
      expect(verifyBuyerAddrHash(sampleAddress, hash.toUpperCase())).toBe(true)
    })
  })
})
