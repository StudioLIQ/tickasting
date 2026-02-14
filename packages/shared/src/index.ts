/**
 * @tickasting/shared
 * Shared utilities for Tickasting
 */

// Payload encoding/decoding
export {
  MAGIC,
  PAYLOAD_VERSION,
  POW_ALGO_SHA256,
  PAYLOAD_LENGTH,
  type PayloadV1,
  PayloadError,
  encodePayload,
  decodePayload,
} from './payload.js'

// Proof of Work
export {
  type PowInput,
  type PowResult,
  buildPowMessage,
  sha256,
  countLeadingZeroBits,
  verifyPow,
  getPowHash,
  solvePow,
  estimateHashCount,
} from './pow.js'

// Address utilities
export { computeBuyerAddrHash, verifyBuyerAddrHash } from './address.js'

// KAS <-> Sompi conversion
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

// Constants
export const SOMPI_PER_KAS = 100_000_000n

// Merkle Tree utilities
export {
  type MerkleLeaf,
  type MerkleProof,
  computeLeafHash,
  buildMerkleTree,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
  verifyLeafInclusion,
  formatMerkleRootForPayload,
  createCommitPayload,
  parseCommitPayload,
} from './merkle.js'

// Ticket QR utilities
export {
  type TicketQRData,
  type SignedTicketQR,
  signTicketData,
  verifyTicketSignature,
  encodeTicketQR,
  decodeTicketQR,
} from './ticket.js'

// Kaspa Adapter
export * from './kaspa/index.js'
