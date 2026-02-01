/**
 * Proof of Work utilities for browser
 *
 * Uses Web Crypto API for SHA-256 hashing.
 * For production, consider using a WebWorker for heavy computation.
 */

import { encodePayload, computeBuyerAddrHash } from '@ghostpass/shared'

export interface PowSolveOptions {
  saleId: string
  buyerAddress: string
  difficulty: number
  onProgress?: (attempts: number) => void
  abortSignal?: AbortSignal
}

export interface PowSolveResult {
  payloadHex: string
  nonce: bigint
  attempts: number
}

/**
 * Build PoW message string
 */
function buildPowMessage(saleId: string, buyerAddrHash: string, nonce: bigint): string {
  return `GhostPassPoW|v1|${saleId}|${buyerAddrHash}|${nonce.toString()}`
}

/**
 * SHA-256 using Web Crypto API
 */
async function sha256(message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer)
}

/**
 * Count leading zero bits in hash
 */
function countLeadingZeroBits(hash: Uint8Array): number {
  let count = 0
  for (const byte of hash) {
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

/**
 * Solve PoW puzzle
 * This is an async implementation that yields control periodically
 * to keep the UI responsive.
 */
export async function solvePow(options: PowSolveOptions): Promise<PowSolveResult> {
  const { saleId, buyerAddress, difficulty, onProgress, abortSignal } = options

  const buyerAddrHash = computeBuyerAddrHash(buyerAddress)
  let nonce = BigInt(0)
  let attempts = 0
  const batchSize = 1000 // Check abort/report progress every N attempts

  while (true) {
    if (abortSignal?.aborted) {
      throw new Error('PoW computation aborted')
    }

    // Process a batch of attempts
    for (let i = 0; i < batchSize; i++) {
      const message = buildPowMessage(saleId, buyerAddrHash, nonce)
      const hash = await sha256(message)
      const zeroBits = countLeadingZeroBits(hash)

      attempts++

      if (zeroBits >= difficulty) {
        // Found valid nonce!
        const payloadHex = encodePayload({
          magic: 'GPS1',
          version: 0x01,
          saleId,
          buyerAddrHash,
          clientTimeMs: BigInt(Date.now()),
          powAlgo: 0x01,
          powDifficulty: difficulty,
          powNonce: nonce,
        })

        return { payloadHex, nonce, attempts }
      }

      nonce++
    }

    // Report progress
    onProgress?.(attempts)

    // Yield control to keep UI responsive
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * Estimate expected hash count for difficulty
 */
export function estimateHashCount(difficulty: number): number {
  return Math.pow(2, difficulty)
}

/**
 * Estimate completion percentage
 */
export function estimateProgress(attempts: number, difficulty: number): number {
  const expected = estimateHashCount(difficulty)
  // Use CDF of geometric distribution
  // P(X <= k) = 1 - (1 - p)^k where p = 1/expected
  const probability = 1 - Math.pow(1 - 1 / expected, attempts)
  return Math.min(probability * 100, 99.9) // Cap at 99.9%
}
