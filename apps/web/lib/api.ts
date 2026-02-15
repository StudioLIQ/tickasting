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

export interface SalesListResponse {
  sales: Sale[]
}

export async function getSale(saleId: string): Promise<Sale> {
  const res = await fetch(`${config.apiBaseUrl}/v1/sales/${saleId}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch sale: ${res.status}`)
  }
  return res.json()
}

export async function getSales(eventId?: string): Promise<SalesListResponse> {
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''
  const res = await fetch(`${config.apiBaseUrl}/v1/sales${query}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch sales: ${res.status}`)
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

export interface SyncClaimPayload {
  kaspaTxid: string
  ticketTypeCode: string
  claimerEvmAddress: string
  claimTxHash: string
  tokenId: string
  finalRank: number
}

export async function syncClaim(saleId: string, payload: SyncClaimPayload): Promise<void> {
  const res = await fetch(`${config.apiBaseUrl}/v1/sales/${saleId}/claims/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `Failed to sync claim: ${res.status}`
    throw new Error(message)
  }
}

export interface MyTicket {
  id: string
  saleId: string
  saleStatus: string
  eventTitle: string
  ticketTypeCode: string | null
  ticketTypeName: string | null
  ownerAddress: string
  originTxid: string
  claimTxid: string | null
  tokenId: string | null
  status: string
  issuedAt: string
  redeemedAt: string | null
  metadata: TicketMetadataSummary
}

export interface MyTicketsResponse {
  ownerAddress: string
  total: number
  tickets: MyTicket[]
}

export async function getMyTickets(
  ownerAddress: string,
  options: {
    saleId?: string
    status?: 'issued' | 'redeemed' | 'cancelled'
    limit?: number
  } = {}
): Promise<MyTicketsResponse> {
  const query = new URLSearchParams({
    ownerAddress,
  })
  if (options.saleId) query.set('saleId', options.saleId)
  if (options.status) query.set('status', options.status)
  if (options.limit) query.set('limit', String(options.limit))

  const res = await fetch(`${config.apiBaseUrl}/v1/tickets?${query.toString()}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch tickets: ${res.status}`)
  }
  return res.json()
}

export interface TicketDetail {
  id: string
  saleId: string
  eventTitle: string
  ticketTypeCode: string | null
  ticketTypeName: string | null
  ownerAddress: string
  ownerAddrHash: string
  tokenId: string | null
  claimTxid: string | null
  originTxid: string
  status: string
  issuedAt: string
  redeemedAt: string | null
  qrCode: string
  metadata: TicketNftMetadata
  recentScans: Array<{
    scannedAt: string
    result: string
    gateId: string | null
  }>
}

export async function getTicket(ticketId: string): Promise<TicketDetail> {
  const res = await fetch(`${config.apiBaseUrl}/v1/tickets/${ticketId}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch ticket: ${res.status}`)
  }
  return res.json()
}

export interface TicketMetadataSummary {
  performanceTitle: string
  performanceDate: string | null
  performanceEndDate: string | null
  venue: string | null
  seat: string
  image: string | null
}

export interface TicketMetadataAttribute {
  trait_type: string
  value: string | number | boolean
}

export interface TicketNftMetadata {
  name: string
  description: string
  image: string | null
  external_url: string | null
  attributes: TicketMetadataAttribute[]
  properties: {
    ticketId: string
    saleId: string
    ownerAddress: string
    ownerAddrHash: string
    originTxid: string
    claimTxid: string | null
    tokenId: string | null
    ticketTypeCode: string | null
    ticketTypeName: string | null
    performanceTitle: string
    performanceDate: string | null
    performanceEndDate: string | null
    venue: string | null
    seat: string
    status: string
  }
}

export async function getTicketMetadata(ticketId: string): Promise<TicketNftMetadata> {
  const res = await fetch(`${config.apiBaseUrl}/v1/tickets/${ticketId}/metadata`)
  if (!res.ok) {
    throw new Error(`Failed to fetch ticket metadata: ${res.status}`)
  }
  return res.json()
}

export interface TicketMutationResponse {
  message: string
  ticket: {
    id: string
    saleId: string
    ownerAddress: string
    status: string
    updatedAt: string
    reason?: string | null
  }
}

export async function transferTicket(
  ticketId: string,
  toAddress: string
): Promise<TicketMutationResponse> {
  const res = await fetch(`${config.apiBaseUrl}/v1/tickets/${ticketId}/transfer`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toAddress }),
  })
  const body = await res.json()
  if (!res.ok) {
    const message = body?.error ? String(body.error) : `Failed to transfer ticket: ${res.status}`
    throw new Error(message)
  }
  return body
}

export async function cancelTicket(
  ticketId: string,
  reason?: string
): Promise<TicketMutationResponse> {
  const res = await fetch(`${config.apiBaseUrl}/v1/tickets/${ticketId}/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  const body = await res.json()
  if (!res.ok) {
    const message = body?.error ? String(body.error) : `Failed to cancel ticket: ${res.status}`
    throw new Error(message)
  }
  return body
}
