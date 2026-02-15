import type { Sale, TicketType } from '@prisma/client'
import { computeBuyerAddrHash } from '@tickasting/shared'
import { prisma } from './db.js'
import { ponderTablesExist } from './ponder-client.js'

const PONDER_SCHEMA = process.env['PONDER_SCHEMA'] || 'public'
const EVM_RPC_URL =
  process.env['CONTRACT_RPC_URL'] ||
  process.env['PONDER_RPC_URL_167012'] ||
  'https://rpc.kasplextest.xyz'
const PURCHASE_MODE = (process.env['PURCHASE_MODE'] || 'evm').toLowerCase()

interface PaymentTransferRow {
  tx_hash: string
  from_address: string
  to_address: string
  value: bigint | number | string | { toString(): string }
  block_hash: string
  block_number: bigint | number | string | { toString(): string }
  block_timestamp: bigint | number | string | { toString(): string }
  log_index: bigint | number | string | { toString(): string }
}

export interface EvmPurchaseAttempt {
  txid: string
  buyerAddress: string
  buyerAddrHash: string
  amount: bigint
  blockHash: string
  blockNumber: bigint
  blockTimestamp: bigint
  logIndex: bigint
  validationStatus: 'valid' | 'invalid_wrong_amount'
  invalidReason: string | null
  accepted: boolean
  confirmations: number
  provisionalRank: number | null
  finalRank: number | null
}

export interface EvmSaleComputed {
  attempts: EvmPurchaseAttempt[]
  validAttempts: EvmPurchaseAttempt[]
  finalAttempts: EvmPurchaseAttempt[]
  winners: EvmPurchaseAttempt[]
}

export function useEvmPurchases(): boolean {
  return PURCHASE_MODE === 'evm'
}

function toDateFromUnixSeconds(seconds: bigint): Date {
  const ms = Number(seconds) * 1000
  return new Date(ms)
}

function sortAttempts(attempts: EvmPurchaseAttempt[]): EvmPurchaseAttempt[] {
  return [...attempts].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
    if (a.logIndex !== b.logIndex) return a.logIndex < b.logIndex ? -1 : 1
    return a.txid.localeCompare(b.txid)
  })
}

function toConfirmations(currentBlock: bigint, blockNumber: bigint): number {
  if (currentBlock < blockNumber) return 0
  const delta = currentBlock - blockNumber + 1n
  const cap = BigInt(Number.MAX_SAFE_INTEGER)
  return Number(delta > cap ? cap : delta)
}

function toBigInt(value: bigint | number | string | { toString(): string }): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'string') return BigInt(value)
  return BigInt(value.toString())
}

async function getCurrentBlockNumber(): Promise<bigint> {
  const res = await fetch(EVM_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    }),
  })
  if (!res.ok) {
    throw new Error(`RPC error: ${res.status}`)
  }
  const json = (await res.json()) as { result?: string }
  if (!json.result) {
    throw new Error('Missing eth_blockNumber result')
  }
  return BigInt(json.result)
}

async function getPaymentTransfersForTreasury(treasuryAddress: string): Promise<PaymentTransferRow[]> {
  const toAddress = treasuryAddress.toLowerCase()
  return prisma.$queryRawUnsafe<PaymentTransferRow[]>(
    `SELECT
      tx_hash,
      from_address,
      to_address,
      value,
      block_hash,
      block_number,
      block_timestamp,
      log_index
    FROM "${PONDER_SCHEMA}"."payment_transfers_onchain"
    WHERE to_address = $1
    ORDER BY block_number ASC, log_index ASC, tx_hash ASC`,
    toAddress
  )
}

function getAllowedAmounts(sale: Sale, ticketTypes: TicketType[]): Set<string> {
  if (ticketTypes.length === 0) return new Set([sale.ticketPriceSompi.toString()])
  return new Set(ticketTypes.map((t) => t.priceSompi.toString()))
}

export async function getEvmSaleComputed(sale: Sale): Promise<EvmSaleComputed> {
  const enabled = useEvmPurchases()
  if (!enabled) {
    return { attempts: [], validAttempts: [], finalAttempts: [], winners: [] }
  }

  const hasPonder = await ponderTablesExist()
  if (!hasPonder) {
    return { attempts: [], validAttempts: [], finalAttempts: [], winners: [] }
  }

  const [ticketTypes, currentBlock, rows] = await Promise.all([
    prisma.ticketType.findMany({ where: { saleId: sale.id } }),
    getCurrentBlockNumber().catch(() => 0n),
    getPaymentTransfersForTreasury(sale.treasuryAddress).catch(() => []),
  ])

  const allowedAmounts = getAllowedAmounts(sale, ticketTypes)

  const baseAttempts: EvmPurchaseAttempt[] = rows
    .filter((row) => {
      const blockTimestamp = toBigInt(row.block_timestamp)
      const blockTime = toDateFromUnixSeconds(blockTimestamp)
      if (sale.startAt && blockTime < sale.startAt) return false
      if (sale.endAt && blockTime > sale.endAt) return false
      return true
    })
    .map((row) => {
      const amount = toBigInt(row.value)
      const blockNumber = toBigInt(row.block_number)
      const blockTimestamp = toBigInt(row.block_timestamp)
      const logIndex = toBigInt(row.log_index)
      const valid = allowedAmounts.has(amount.toString())
      return {
        txid: row.tx_hash.toLowerCase(),
        buyerAddress: row.from_address.toLowerCase(),
        buyerAddrHash: computeBuyerAddrHash(row.from_address.toLowerCase()),
        amount,
        blockHash: row.block_hash.toLowerCase(),
        blockNumber,
        blockTimestamp,
        logIndex,
        validationStatus: valid ? 'valid' : 'invalid_wrong_amount',
        invalidReason: valid ? null : `Amount mismatch: got ${amount.toString()}`,
        accepted: true,
        confirmations: toConfirmations(currentBlock, blockNumber),
        provisionalRank: null,
        finalRank: null,
      }
    })

  const attempts = sortAttempts(baseAttempts)
  const validAttempts = attempts.filter((a) => a.validationStatus === 'valid')

  validAttempts.forEach((attempt, index) => {
    attempt.provisionalRank = index + 1
  })

  const finalAttempts = validAttempts.filter((a) => a.confirmations >= sale.finalityDepth)
  finalAttempts.forEach((attempt, index) => {
    attempt.finalRank = index + 1
  })

  const winners = finalAttempts.slice(0, sale.supplyTotal)
  return { attempts, validAttempts, finalAttempts, winners }
}

export async function findEvmAttemptByTxid(
  sale: Sale,
  txid: string
): Promise<EvmPurchaseAttempt | null> {
  const computed = await getEvmSaleComputed(sale)
  const normalized = txid.toLowerCase()
  return computed.attempts.find((a) => a.txid === normalized) || null
}
