/**
 * API Client for Tickasting Backend
 */

import { config } from './config'

export interface TicketType {
  id: string
  saleId: string
  code: string
  name: string
  priceSompi: string
  supply: number
  metadataUri: string | null
  perk: Record<string, unknown> | null
  sortOrder: number
  createdAt: string
  minted?: number
  remaining?: number
}

export interface Sale {
  id: string
  eventId: string
  network: string
  treasuryAddress: string
  ticketPriceSompi: string
  supplyTotal: number
  maxPerAddress: number | null
  powDifficulty: number
  finalityDepth: number
  fallbackEnabled: boolean
  startAt: string | null
  endAt: string | null
  status: string
  merkleRoot: string | null
  commitTxid: string | null
  claimContractAddress: string | null
  createdAt: string
  eventTitle?: string
  ticketTypes?: TicketType[]
}

export interface MyStatus {
  found: boolean
  saleId?: string
  txid?: string
  validationStatus?: string
  invalidReason?: string | null
  accepted?: boolean
  confirmations?: number
  provisionalRank?: number | null
  finalRank?: number | null
  isWinner?: boolean
  isFallback?: boolean
  acceptingBlockHash?: string | null
  detectedAt?: string
  lastCheckedAt?: string | null
  message?: string
}

export interface SaleStats {
  saleId: string
  status: string
  supplyTotal: number
  remaining: number
  totalAttempts: number
  validAttempts: number
  acceptedAttempts: number
  finalAttempts: number
  finalityDepth: number
  timestamp: string
}

export async function getSale(saleId: string): Promise<Sale> {
  const res = await fetch(`${config.apiBaseUrl}/v1/sales/${saleId}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch sale: ${res.status}`)
  }
  return res.json()
}

export async function getSaleStats(saleId: string): Promise<SaleStats> {
  const res = await fetch(`${config.apiBaseUrl}/v1/sales/${saleId}/stats`)
  if (!res.ok) {
    throw new Error(`Failed to fetch stats: ${res.status}`)
  }
  return res.json()
}

export async function getMyStatus(saleId: string, txid: string): Promise<MyStatus> {
  const res = await fetch(
    `${config.apiBaseUrl}/v1/sales/${saleId}/my-status?txid=${encodeURIComponent(txid)}`
  )
  if (!res.ok) {
    throw new Error(`Failed to fetch status: ${res.status}`)
  }
  return res.json()
}

export interface AllocationWinner {
  finalRank: number
  txid: string
  acceptingBlockHash: string | null
  acceptingBlueScore: string | null
  confirmations: number
  buyerAddrHash: string | null
}

export interface AllocationSnapshot {
  saleId: string
  network: string
  treasuryAddress: string
  ticketPriceSompi: string
  supplyTotal: number
  finalityDepth: number
  pow: { algo: string; difficulty: number }
  orderingRule: { primary: string; tiebreaker: string }
  generatedAt: string
  totalAttempts: number
  validAttempts: number
  winners: AllocationWinner[]
  losersCount: number
  merkleRoot: string | null
  commitTxid: string | null
}

export interface MerkleProofResponse {
  found: boolean
  txid: string
  finalRank?: number
  leaf?: {
    finalRank: number
    txid: string
    acceptingBlockHash: string | null
    acceptingBlueScore: string | null
    buyerAddrHash: string | null
  }
  proof?: Array<{ hash: string; position: 'left' | 'right' }>
  merkleRoot?: string
  commitTxid?: string | null
  message?: string
}

export async function getAllocation(saleId: string): Promise<AllocationSnapshot> {
  const res = await fetch(`${config.apiBaseUrl}/v1/sales/${saleId}/allocation`)
  if (!res.ok) {
    throw new Error(`Failed to fetch allocation: ${res.status}`)
  }
  return res.json()
}

export async function getMerkleProof(saleId: string, txid: string): Promise<MerkleProofResponse> {
  const res = await fetch(
    `${config.apiBaseUrl}/v1/sales/${saleId}/merkle-proof?txid=${encodeURIComponent(txid)}`
  )
  if (!res.ok) {
    throw new Error(`Failed to fetch merkle proof: ${res.status}`)
  }
  return res.json()
}

export interface TicketTypesResponse {
  saleId: string
  ticketTypes: (TicketType & { minted: number; remaining: number })[]
}

export async function getTicketTypes(saleId: string): Promise<TicketTypesResponse> {
  const res = await fetch(`${config.apiBaseUrl}/v1/sales/${saleId}/ticket-types`)
  if (!res.ok) {
    throw new Error(`Failed to fetch ticket types: ${res.status}`)
  }
  return res.json()
}

export interface ClaimStatusResponse {
  saleId: string
  totalTickets: number
  claimed: number
  unclaimed: number
  tickets: Array<{
    id: string
    originTxid: string
    ticketTypeCode: string | null
    ownerAddress: string
    claimTxid: string | null
    tokenId: string | null
    status: string
    issuedAt: string
  }>
}

export async function getClaimStatus(saleId: string): Promise<ClaimStatusResponse> {
  const res = await fetch(`${config.apiBaseUrl}/v1/sales/${saleId}/claims`)
  if (!res.ok) {
    throw new Error(`Failed to fetch claim status: ${res.status}`)
  }
  return res.json()
}
