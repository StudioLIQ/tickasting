/**
 * Kaspa.org REST API Adapter
 *
 * Uses public Kaspa REST endpoints:
 * - Mainnet: https://api.kaspa.org
 * - Testnet-10: https://api-tn10.kaspa.org
 *
 * OpenAPI: https://api.kaspa.org/openapi.json
 */

import type {
  KaspaAdapter,
  KaspaTransaction,
  KaspaBlock,
  TransactionAcceptance,
  AddressTransactionsOptions,
  AddressTransactionsResult,
} from './types.js'

export interface KaspaOrgAdapterConfig {
  baseUrl?: string
  network?: 'mainnet' | 'testnet'
  maxRetries?: number
  retryDelayMs?: number
}

const DEFAULT_MAINNET_BASE_URL = 'https://api.kaspa.org'
const DEFAULT_TESTNET_BASE_URL = 'https://api-tn10.kaspa.org'

interface KaspaOrgTxInput {
  previous_outpoint_hash: string
  previous_outpoint_index: string | number
  signature_script?: string
  sig_op_count?: string | number
}

interface KaspaOrgTxOutput {
  amount: string | number
  script_public_key?: string
  script_public_key_address?: string
}

interface KaspaOrgTxModel {
  transaction_id?: string
  hash?: string
  payload?: string | null
  block_time?: number
  is_accepted?: boolean
  accepting_block_hash?: string
  accepting_block_blue_score?: string | number
  inputs?: Array<KaspaOrgTxInput | null>
  outputs?: Array<KaspaOrgTxOutput | null>
}

interface KaspaOrgTxAcceptanceResponse {
  transactionId?: string
  accepted: boolean
  acceptingBlockHash?: string
  acceptingBlueScore?: string | number
}

interface KaspaOrgNetworkInfoResponse {
  networkName?: string
  virtualDaaScore?: string | number
  sink?: string
  tipHashes?: string[]
}

interface KaspaOrgBlueScoreResponse {
  blueScore: string | number
}

interface KaspaOrgBlockResponse {
  header?: {
    timestamp?: string | number
    blueScore?: string | number
    parents?: Array<{ parentHashes?: string[] }>
  }
  verboseData?: {
    hash?: string
    blueScore?: string | number
    selectedParentHash?: string
  }
}

export class KaspaOrgAdapter implements KaspaAdapter {
  private readonly baseUrl: string
  private readonly maxRetries: number
  private readonly retryDelayMs: number

  constructor(config: KaspaOrgAdapterConfig = {}) {
    const envBase = process.env['KASPA_REST_BASE_URL']
    const network = config.network || 'testnet'
    this.baseUrl =
      config.baseUrl ||
      envBase ||
      (network === 'testnet' ? DEFAULT_TESTNET_BASE_URL : DEFAULT_MAINNET_BASE_URL)
    this.maxRetries = config.maxRetries ?? 3
    this.retryDelayMs = config.retryDelayMs ?? 1000
  }

  private async requestJson<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<{ data: T; headers: Headers }> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, options)

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After')
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : this.retryDelayMs * (attempt + 1)
          await this.sleep(waitMs)
          continue
        }

        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Kaspa.org API error: ${response.status} ${text}`)
        }

        return {
          data: (await response.json()) as T,
          headers: response.headers,
        }
      } catch (error) {
        lastError = error as Error
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelayMs * (attempt + 1))
        }
      }
    }

    throw lastError || new Error('Request failed after retries')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private toBigInt(value: string | number | undefined | null, fallback = 0n): bigint {
    if (value === undefined || value === null) return fallback
    try {
      return BigInt(value.toString())
    } catch {
      return fallback
    }
  }

  private toNumber(value: string | number | undefined | null, fallback = 0): number {
    if (value === undefined || value === null) return fallback
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  private toOptionalNumber(value: string | number | undefined | null): number | undefined {
    if (value === undefined || value === null) return undefined
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }

  private async getCurrentBlueScore(): Promise<bigint> {
    const response = await this.requestJson<KaspaOrgBlueScoreResponse>('/info/virtual-chain-blue-score')
    return this.toBigInt(response.data.blueScore)
  }

  private buildConfirmations(
    accepted: boolean,
    acceptingBlueScore: bigint | null,
    currentBlueScore: bigint
  ): number {
    if (!accepted || acceptingBlueScore === null) return 0
    if (currentBlueScore <= acceptingBlueScore) return 0

    const delta = currentBlueScore - acceptingBlueScore
    const maxSafeBigint = BigInt(Number.MAX_SAFE_INTEGER)
    if (delta > maxSafeBigint) return Number.MAX_SAFE_INTEGER
    return Number(delta)
  }

  private mapTransaction(tx: KaspaOrgTxModel, currentBlueScore: bigint): KaspaTransaction {
    const acceptingBlueScoreRaw = this.toBigInt(tx.accepting_block_blue_score, -1n)
    const acceptingBlueScore = acceptingBlueScoreRaw >= 0n ? acceptingBlueScoreRaw : null
    const accepted = !!tx.is_accepted
    const inputs = (tx.inputs || []).filter((input): input is KaspaOrgTxInput => !!input)
    const outputs = (tx.outputs || []).filter((output): output is KaspaOrgTxOutput => !!output)

    return {
      txid: tx.transaction_id || tx.hash || '',
      blockTime: this.toOptionalNumber(tx.block_time),
      isAccepted: accepted,
      acceptingBlockHash: tx.accepting_block_hash,
      confirmations: this.buildConfirmations(accepted, acceptingBlueScore, currentBlueScore),
      inputs: inputs.map((input) => ({
        previousOutpoint: {
          transactionId: input.previous_outpoint_hash || '',
          index: this.toNumber(input.previous_outpoint_index),
        },
        signatureScript: input.signature_script,
        sigOpCount: this.toOptionalNumber(input.sig_op_count),
      })),
      outputs: outputs.map((output) => ({
        value: this.toBigInt(output.amount),
        scriptPublicKey: {
          scriptPublicKey: output.script_public_key || '',
        },
        address: output.script_public_key_address,
      })),
      payload: tx.payload || undefined,
    }
  }

  async getAddressTransactions(
    address: string,
    options: AddressTransactionsOptions = {}
  ): Promise<AddressTransactionsResult> {
    const params = new URLSearchParams()
    params.set('limit', String(options.limit ?? 100))
    params.set('resolve_previous_outpoints', 'no')

    if (options.acceptedOnly) params.set('acceptance', 'accepted')
    if (options.cursor) params.set('before', options.cursor)

    const [txResp, blueScore] = await Promise.all([
      this.requestJson<KaspaOrgTxModel[]>(
        `/addresses/${encodeURIComponent(address)}/full-transactions-page?${params.toString()}`
      ),
      this.getCurrentBlueScore().catch(() => 0n),
    ])

    const nextCursor =
      txResp.headers.get('x-next-page-before') ||
      txResp.headers.get('X-Next-Page-Before') ||
      undefined

    return {
      transactions: txResp.data.map((tx) => this.mapTransaction(tx, blueScore)),
      cursor: nextCursor,
      hasMore: !!nextCursor,
    }
  }

  async getTransactionsAcceptance(txids: string[]): Promise<TransactionAcceptance[]> {
    if (txids.length === 0) return []

    const [acceptanceResp, blueScore] = await Promise.all([
      this.requestJson<KaspaOrgTxAcceptanceResponse[]>('/transactions/acceptance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionIds: txids }),
      }),
      this.getCurrentBlueScore().catch(() => 0n),
    ])

    return acceptanceResp.data.map((tx) => {
      const acceptingBlueScoreRaw = this.toBigInt(tx.acceptingBlueScore, -1n)
      const acceptingBlueScore = acceptingBlueScoreRaw >= 0n ? acceptingBlueScoreRaw : null
      return {
        txid: tx.transactionId || '',
        isAccepted: tx.accepted,
        acceptingBlockHash: tx.acceptingBlockHash,
        confirmations: this.buildConfirmations(tx.accepted, acceptingBlueScore, blueScore),
      }
    })
  }

  async getTransactionDetails(txid: string, _includePayload = true): Promise<KaspaTransaction | null> {
    try {
      const [txResp, blueScore] = await Promise.all([
        this.requestJson<KaspaOrgTxModel>(
          `/transactions/${txid}?inputs=true&outputs=true&resolve_previous_outpoints=no`
        ),
        this.getCurrentBlueScore().catch(() => 0n),
      ])
      return this.mapTransaction(txResp.data, blueScore)
    } catch {
      return null
    }
  }

  async getBlockDetails(hash: string): Promise<KaspaBlock | null> {
    try {
      const response = await this.requestJson<KaspaOrgBlockResponse>(
        `/blocks/${hash}?includeTransactions=false`
      )
      const block = response.data
      const parentHashes = (block.header?.parents || []).flatMap((p) => p.parentHashes || [])

      return {
        hash: block.verboseData?.hash || hash,
        blueScore: this.toBigInt(block.verboseData?.blueScore ?? block.header?.blueScore),
        timestamp: this.toNumber(block.header?.timestamp),
        parentHashes,
      }
    } catch {
      return null
    }
  }

  async getNetworkInfo(): Promise<{
    network: string
    virtualDaaScore: bigint
    tipHash: string
  }> {
    const response = await this.requestJson<KaspaOrgNetworkInfoResponse>('/info/network')
    const info = response.data
    return {
      network: info.networkName || 'unknown',
      virtualDaaScore: this.toBigInt(info.virtualDaaScore),
      tipHash: info.sink || info.tipHashes?.[0] || '',
    }
  }
}
