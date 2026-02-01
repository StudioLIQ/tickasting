/**
 * API Client for GhostPass Backend
 */

import { config } from './config'

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
  startAt: string | null
  endAt: string | null
  status: string
  merkleRoot: string | null
  commitTxid: string | null
  createdAt: string
  eventTitle?: string
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
