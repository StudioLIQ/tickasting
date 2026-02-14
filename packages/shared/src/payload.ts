/**
 * Tickasting Payload v1 Encoder/Decoder
 *
 * Payload binary format (hex string):
 * - magic(4): "TKS1"
 * - version(1): 0x01
 * - saleId(16): UUIDv4 bytes
 * - buyerAddrHash(20): first 20 bytes of sha256(address)
 * - clientTimeMs(8): uint64 big-endian
 * - powAlgo(1): 0x01 = sha256
 * - powDifficulty(1): e.g. 18
 * - powNonce(8): uint64 big-endian
 *
 * Total: 4 + 1 + 16 + 20 + 8 + 1 + 1 + 8 = 59 bytes
 */

export const MAGIC = 'TKS1'
export const PAYLOAD_VERSION = 0x01
export const POW_ALGO_SHA256 = 0x01
export const PAYLOAD_LENGTH = 59

export interface PayloadV1 {
  magic: string
  version: number
  saleId: string // UUID string format
  buyerAddrHash: string // hex string (40 chars)
  clientTimeMs: bigint
  powAlgo: number
  powDifficulty: number
  powNonce: bigint
}

export class PayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayloadError'
  }
}

/**
 * Convert UUID string to 16 bytes
 */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32) {
    throw new PayloadError(`Invalid UUID: ${uuid}`)
  }
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Convert 16 bytes to UUID string
 */
function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const length = hex.length / 2
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Write uint64 big-endian to buffer
 */
function writeUint64BE(buffer: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  view.setBigUint64(offset, value, false) // big-endian
}

/**
 * Read uint64 big-endian from buffer
 */
function readUint64BE(buffer: Uint8Array, offset: number): bigint {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  return view.getBigUint64(offset, false) // big-endian
}

/**
 * Encode PayloadV1 to hex string
 */
export function encodePayload(payload: PayloadV1): string {
  const buffer = new Uint8Array(PAYLOAD_LENGTH)
  let offset = 0

  // magic (4 bytes)
  const magicBytes = new TextEncoder().encode(MAGIC)
  buffer.set(magicBytes, offset)
  offset += 4

  // version (1 byte)
  buffer[offset] = payload.version
  offset += 1

  // saleId (16 bytes)
  const saleIdBytes = uuidToBytes(payload.saleId)
  buffer.set(saleIdBytes, offset)
  offset += 16

  // buyerAddrHash (20 bytes)
  if (payload.buyerAddrHash.length !== 40) {
    throw new PayloadError(`buyerAddrHash must be 40 hex chars, got ${payload.buyerAddrHash.length}`)
  }
  const addrHashBytes = hexToBytes(payload.buyerAddrHash)
  buffer.set(addrHashBytes, offset)
  offset += 20

  // clientTimeMs (8 bytes)
  writeUint64BE(buffer, offset, payload.clientTimeMs)
  offset += 8

  // powAlgo (1 byte)
  buffer[offset] = payload.powAlgo
  offset += 1

  // powDifficulty (1 byte)
  buffer[offset] = payload.powDifficulty
  offset += 1

  // powNonce (8 bytes)
  writeUint64BE(buffer, offset, payload.powNonce)

  return bytesToHex(buffer)
}

/**
 * Decode hex string to PayloadV1
 */
export function decodePayload(hex: string): PayloadV1 {
  if (hex.length !== PAYLOAD_LENGTH * 2) {
    throw new PayloadError(`Invalid payload length: expected ${PAYLOAD_LENGTH * 2} hex chars, got ${hex.length}`)
  }

  const buffer = hexToBytes(hex)
  let offset = 0

  // magic (4 bytes)
  const magicBytes = buffer.slice(offset, offset + 4)
  const magic = new TextDecoder().decode(magicBytes)
  if (magic !== MAGIC) {
    throw new PayloadError(`Invalid magic: expected ${MAGIC}, got ${magic}`)
  }
  offset += 4

  // version (1 byte)
  const version = buffer[offset]!
  if (version !== PAYLOAD_VERSION) {
    throw new PayloadError(`Unsupported version: ${version}`)
  }
  offset += 1

  // saleId (16 bytes)
  const saleIdBytes = buffer.slice(offset, offset + 16)
  const saleId = bytesToUuid(saleIdBytes)
  offset += 16

  // buyerAddrHash (20 bytes)
  const addrHashBytes = buffer.slice(offset, offset + 20)
  const buyerAddrHash = bytesToHex(addrHashBytes)
  offset += 20

  // clientTimeMs (8 bytes)
  const clientTimeMs = readUint64BE(buffer, offset)
  offset += 8

  // powAlgo (1 byte)
  const powAlgo = buffer[offset]!
  offset += 1

  // powDifficulty (1 byte)
  const powDifficulty = buffer[offset]!
  offset += 1

  // powNonce (8 bytes)
  const powNonce = readUint64BE(buffer, offset)

  return {
    magic,
    version,
    saleId,
    buyerAddrHash,
    clientTimeMs,
    powAlgo,
    powDifficulty,
    powNonce,
  }
}
