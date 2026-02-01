/**
 * @ghostpass/shared
 * Shared utilities for GhostPass
 */

// Constants
export const MAGIC = 'GPS1'
export const PAYLOAD_VERSION = 0x01
export const POW_ALGO_SHA256 = 0x01

// Types
export interface PayloadV1 {
  magic: string
  version: number
  saleId: string
  buyerAddrHash: string
  clientTimeMs: bigint
  powAlgo: number
  powDifficulty: number
  powNonce: bigint
}

export interface PowInput {
  saleId: string
  buyerAddrHash: string
  difficulty: number
}

export interface PowResult {
  nonce: bigint
  hash: string
}

// Placeholder exports (will be implemented in GP-003)
export function encodePayload(_payload: PayloadV1): string {
  throw new Error('Not implemented - see GP-003')
}

export function decodePayload(_hex: string): PayloadV1 {
  throw new Error('Not implemented - see GP-003')
}

export function solvePow(_input: PowInput): PowResult {
  throw new Error('Not implemented - see GP-003')
}

export function verifyPow(_input: PowInput, _nonce: bigint): boolean {
  throw new Error('Not implemented - see GP-003')
}

// Utility
export function sompiToKas(sompi: bigint): string {
  const kasWhole = sompi / 100_000_000n
  const kasFrac = sompi % 100_000_000n
  return `${kasWhole}.${kasFrac.toString().padStart(8, '0')}`
}

export function kasToSompi(kas: string): bigint {
  const [whole, frac = '0'] = kas.split('.')
  const fracPadded = frac.padEnd(8, '0').slice(0, 8)
  return BigInt(whole || '0') * 100_000_000n + BigInt(fracPadded)
}
