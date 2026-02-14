/**
 * Tickasting Anti-Bot PoW (Proof of Work)
 *
 * Puzzle Definition (v1):
 * - Hash: SHA-256
 * - Input: "TickastingPoW|v1|{saleId}|{buyerAddrHashHex}|{nonceUint64}"
 * - Condition: leading zero bits >= difficulty
 *
 * Difficulty examples:
 * - 8: ~256 hashes average (instant)
 * - 16: ~65K hashes average (~0.1s on desktop)
 * - 18: ~262K hashes average (~0.2-1s on desktop)
 * - 20: ~1M hashes average (~1-2s on desktop)
 * - 24: ~16M hashes average (~5-20s on desktop)
 */

import { createHash } from 'crypto'

export interface PowInput {
  saleId: string // UUID string
  buyerAddrHash: string // hex string (40 chars)
  difficulty: number // number of leading zero bits required
}

export interface PowResult {
  nonce: bigint
  hash: string // hex string of the valid hash
}

/**
 * Build the PoW message to hash
 */
export function buildPowMessage(saleId: string, buyerAddrHash: string, nonce: bigint): string {
  return `TickastingPoW|v1|${saleId}|${buyerAddrHash}|${nonce.toString()}`
}

/**
 * Compute SHA-256 hash (Node.js)
 */
export function sha256(message: string): Uint8Array {
  const hash = createHash('sha256')
  hash.update(message)
  return new Uint8Array(hash.digest())
}

/**
 * Count leading zero bits in a byte array
 */
export function countLeadingZeroBits(hash: Uint8Array): number {
  let count = 0
  for (const byte of hash) {
    if (byte === 0) {
      count += 8
    } else {
      // Count leading zeros in this byte
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

/**
 * Convert hash to hex string
 */
function hashToHex(hash: Uint8Array): string {
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verify a PoW solution
 */
export function verifyPow(input: PowInput, nonce: bigint): boolean {
  const message = buildPowMessage(input.saleId, input.buyerAddrHash, nonce)
  const hash = sha256(message)
  const zeroBits = countLeadingZeroBits(hash)
  return zeroBits >= input.difficulty
}

/**
 * Get hash for a PoW attempt (for debugging/verification)
 */
export function getPowHash(input: PowInput, nonce: bigint): string {
  const message = buildPowMessage(input.saleId, input.buyerAddrHash, nonce)
  const hash = sha256(message)
  return hashToHex(hash)
}

/**
 * Solve PoW puzzle (synchronous, for server-side use)
 * Returns when a valid nonce is found
 *
 * NOTE: For browser use, implement async WebWorker version
 */
export function solvePow(input: PowInput, startNonce = 0n, maxIterations?: bigint): PowResult {
  let nonce = startNonce
  const maxIter = maxIterations ?? BigInt(2 ** 32) // Default max: 4 billion

  while (nonce < startNonce + maxIter) {
    const message = buildPowMessage(input.saleId, input.buyerAddrHash, nonce)
    const hash = sha256(message)
    const zeroBits = countLeadingZeroBits(hash)

    if (zeroBits >= input.difficulty) {
      return {
        nonce,
        hash: hashToHex(hash),
      }
    }

    nonce++
  }

  throw new Error(`PoW not found within ${maxIter} iterations`)
}

/**
 * Estimate number of hashes needed for given difficulty
 * Expected hashes = 2^difficulty
 */
export function estimateHashCount(difficulty: number): bigint {
  return BigInt(2 ** difficulty)
}
