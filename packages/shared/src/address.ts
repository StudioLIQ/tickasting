/**
 * Address utilities
 */

import { createHash } from 'crypto'

/**
 * Compute buyerAddrHash from a Kaspa address
 * Returns first 20 bytes of SHA-256(address) as hex string
 */
export function computeBuyerAddrHash(address: string): string {
  const hash = createHash('sha256')
  hash.update(address)
  const fullHash = hash.digest()
  // Take first 20 bytes
  const addrHash = fullHash.subarray(0, 20)
  return Array.from(addrHash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verify that a buyerAddrHash matches an address
 */
export function verifyBuyerAddrHash(address: string, buyerAddrHash: string): boolean {
  const computed = computeBuyerAddrHash(address)
  return computed.toLowerCase() === buyerAddrHash.toLowerCase()
}
