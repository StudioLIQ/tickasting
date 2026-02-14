/**
 * Ponder Client — Query Ponder-managed on-chain tables
 *
 * Ponder indexes contract events into tables in the same Postgres database.
 * This module provides typed queries for the API to read from Ponder tables.
 *
 * Tables (from apps/ponder/ponder.schema.ts):
 * - sales_onchain
 * - ticket_types_onchain
 * - claims_onchain
 * - token_ownership
 */

import { prisma } from './db.js'

// Feature flag: when true, API reads on-chain data from Ponder tables
export const USE_PONDER_DATA = process.env['USE_PONDER_DATA'] === 'true'

// Ponder schema name (Ponder creates tables in this Postgres schema)
const PONDER_SCHEMA = process.env['PONDER_SCHEMA'] || 'public'

interface PonderSale {
  id: string
  organizer: string
  start_at: bigint
  end_at: bigint
  merkle_root: string | null
  status: string
  total_minted: bigint | null
  block_number: bigint
  block_timestamp: bigint
  transaction_hash: string
}

interface PonderClaim {
  id: string
  sale_id: string
  type_code: string
  claimer: string
  token_id: bigint
  kaspa_txid: string
  final_rank: bigint
  block_number: bigint
  block_timestamp: bigint
  transaction_hash: string
}

interface PonderTicketType {
  id: string
  sale_id: string
  type_code: string
  name: string
  supply: bigint
  price_sompi: bigint
  claimed: bigint
  block_number: bigint
  block_timestamp: bigint
  transaction_hash: string
}

interface PonderToken {
  id: bigint
  owner: string
  type_code: string | null
  sale_id: string | null
  block_number: bigint
  block_timestamp: bigint
}

/**
 * Check if Ponder tables exist in the database
 */
export async function ponderTablesExist(): Promise<boolean> {
  try {
    const result = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = '${PONDER_SCHEMA}'
        AND table_name = 'claims_onchain'
      )`
    )
    return result[0]?.exists ?? false
  } catch {
    return false
  }
}

/**
 * Get on-chain claims for a sale from Ponder tables
 */
export async function getPonderClaims(saleId: string): Promise<PonderClaim[]> {
  return prisma.$queryRawUnsafe<PonderClaim[]>(
    `SELECT * FROM "${PONDER_SCHEMA}"."claims_onchain" WHERE sale_id = $1 ORDER BY final_rank ASC`,
    saleId
  )
}

/**
 * Get on-chain sale data from Ponder tables
 */
export async function getPonderSale(saleId: string): Promise<PonderSale | null> {
  const results = await prisma.$queryRawUnsafe<PonderSale[]>(
    `SELECT * FROM "${PONDER_SCHEMA}"."sales_onchain" WHERE id = $1 LIMIT 1`,
    saleId
  )
  return results[0] ?? null
}

/**
 * Get on-chain ticket types from Ponder tables
 */
export async function getPonderTicketTypes(saleId: string): Promise<PonderTicketType[]> {
  return prisma.$queryRawUnsafe<PonderTicketType[]>(
    `SELECT * FROM "${PONDER_SCHEMA}"."ticket_types_onchain" WHERE sale_id = $1`,
    saleId
  )
}

/**
 * Get token ownership for a specific token
 */
export async function getPonderToken(tokenId: bigint): Promise<PonderToken | null> {
  const results = await prisma.$queryRawUnsafe<PonderToken[]>(
    `SELECT * FROM "${PONDER_SCHEMA}"."token_ownership" WHERE id = $1 LIMIT 1`,
    tokenId
  )
  return results[0] ?? null
}

/**
 * Get all claimed tokens for an address from Ponder tables
 */
export async function getPonderClaimsByAddress(claimer: string): Promise<PonderClaim[]> {
  return prisma.$queryRawUnsafe<PonderClaim[]>(
    `SELECT * FROM "${PONDER_SCHEMA}"."claims_onchain" WHERE claimer = $1 ORDER BY final_rank ASC`,
    claimer.toLowerCase()
  )
}

/**
 * Format Ponder claim data for API response
 */
export function formatPonderClaim(claim: PonderClaim) {
  return {
    id: claim.id,
    saleId: claim.sale_id,
    typeCode: claim.type_code,
    claimer: claim.claimer,
    tokenId: claim.token_id.toString(),
    kaspaTxid: claim.kaspa_txid,
    finalRank: Number(claim.final_rank),
    blockNumber: Number(claim.block_number),
    blockTimestamp: Number(claim.block_timestamp),
    transactionHash: claim.transaction_hash,
  }
}
