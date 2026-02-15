/**
 * Kas.fyi API Adapter
 *
 * Implementation of KaspaAdapter using Kas.fyi Developer Platform API.
 * Documentation: https://docs.kas.fyi/
 */

import type {
  KaspaAdapter,
  KaspaTransaction,
  KaspaBlock,
  TransactionAcceptance,
  AddressTransactionsOptions,
  AddressTransactionsResult,
} from './types.js'

export interface KasFyiAdapterConfig {
  apiKey?: string
  baseUrl?: string
  network?: 'mainnet' | 'testnet'
  maxRetries?: number
  retryDelayMs?: number
}

const DEFAULT_BASE_URL = 'https://api.kas.fyi'
const DEFAULT_TESTNET_URL = 'https://api.kas.fyi'

export class KasFyiAdapter implements KaspaAdapter {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly maxRetries: number
  private readonly retryDelayMs: number

  constructor(config: KasFyiAdapterConfig = {}) {
    this.apiKey = config.apiKey || process.env['KASFYI_API_KEY']
    this.maxRetries = config.maxRetries ?? 3
    this.retryDelayMs = config.retryDelayMs ?? 1000

    // Determine base URL
    const envBaseUrl = process.env['KASFYI_BASE_URL']
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl
    } else if (envBaseUrl) {
      this.baseUrl = envBaseUrl
    } else if (config.network === 'testnet') {
      this.baseUrl = DEFAULT_TESTNET_URL
    } else {
      this.baseUrl = DEFAULT_BASE_URL
    }
  }

  private normalizeEndpoint(endpoint: string): string {
    const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    // Kas.fyi latest API reference uses /v1 prefix.
    if (normalized.startsWith('/v1/')) return normalized
    return `/v1${normalized}`
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${this.normalizeEndpoint(endpoint)}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>),
    }

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
        })

        if (response.status === 429) {
          // Rate limited - wait and retry
          const retryAfter = response.headers.get('Retry-After')
          const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : this.retryDelayMs * (attempt + 1)
          await this.sleep(waitMs)
          continue
        }

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Kas.fyi API error: ${response.status} ${errorText}`)
        }

        return (await response.json()) as T
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

  async getAddressTransactions(
    address: string,
    options: AddressTransactionsOptions = {}
  ): Promise<AddressTransactionsResult> {
    const params = new URLSearchParams()
    if (options.limit) params.set('limit', options.limit.toString())
    if (options.offset) params.set('offset', options.offset.toString())
    if (options.cursor) params.set('cursor', options.cursor)

    const endpoint = `/addresses/${address}/transactions?${params.toString()}`

    interface ApiResponse {
      transactions: ApiTransaction[]
      cursor?: string
    }

    interface ApiTransaction {
      transactionId: string
      blockTime?: number
      isAccepted?: boolean
      acceptingBlockHash?: string
      confirmations?: number
      inputs?: Array<{
        previousOutpoint?: {
          transactionId: string
          index: number
        }
      }>
      outputs?: Array<{
        value: string
        scriptPublicKey?: {
          scriptPublicKey: string
        }
        address?: string
      }>
      payload?: string
    }

    const data = await this.fetch<ApiResponse>(endpoint)

    const transactions: KaspaTransaction[] = data.transactions.map((tx) => ({
      txid: tx.transactionId,
      blockTime: tx.blockTime,
      isAccepted: tx.isAccepted ?? false,
      acceptingBlockHash: tx.acceptingBlockHash,
      confirmations: tx.confirmations ?? 0,
      inputs: (tx.inputs || []).map((input) => ({
        previousOutpoint: {
          transactionId: input.previousOutpoint?.transactionId || '',
          index: input.previousOutpoint?.index || 0,
        },
      })),
      outputs: (tx.outputs || []).map((output) => ({
        value: BigInt(output.value || '0'),
        scriptPublicKey: {
          scriptPublicKey: output.scriptPublicKey?.scriptPublicKey || '',
        },
        address: output.address,
      })),
      payload: tx.payload,
    }))

    return {
      transactions,
      cursor: data.cursor,
      hasMore: !!data.cursor,
    }
  }

  async getTransactionsAcceptance(txids: string[]): Promise<TransactionAcceptance[]> {
    if (txids.length === 0) return []

    // Kas.fyi accepts batch requests for transaction acceptance
    // POST /transactions/acceptance with body { transactionIds: [...] }
    interface ApiResponse {
      transactions: Array<{
        transactionId: string
        isAccepted: boolean
        acceptingBlockHash?: string
        confirmations?: number
      }>
    }

    const data = await this.fetch<ApiResponse>('/transactions/acceptance', {
      method: 'POST',
      body: JSON.stringify({ transactionIds: txids }),
    })

    return data.transactions.map((tx) => ({
      txid: tx.transactionId,
      isAccepted: tx.isAccepted,
      acceptingBlockHash: tx.acceptingBlockHash,
      confirmations: tx.confirmations ?? 0,
    }))
  }

  async getTransactionDetails(txid: string, includePayload = true): Promise<KaspaTransaction | null> {
    try {
      interface ApiTransaction {
        transactionId: string
        blockTime?: number
        isAccepted?: boolean
        acceptingBlockHash?: string
        confirmations?: number
        inputs?: Array<{
          previousOutpoint?: {
            transactionId: string
            index: number
          }
        }>
        outputs?: Array<{
          value: string
          scriptPublicKey?: {
            scriptPublicKey: string
          }
          address?: string
        }>
        payload?: string
      }

      const params = includePayload ? '?includePayload=true' : ''
      const tx = await this.fetch<ApiTransaction>(`/transactions/${txid}${params}`)

      return {
        txid: tx.transactionId,
        blockTime: tx.blockTime,
        isAccepted: tx.isAccepted ?? false,
        acceptingBlockHash: tx.acceptingBlockHash,
        confirmations: tx.confirmations ?? 0,
        inputs: (tx.inputs || []).map((input) => ({
          previousOutpoint: {
            transactionId: input.previousOutpoint?.transactionId || '',
            index: input.previousOutpoint?.index || 0,
          },
        })),
        outputs: (tx.outputs || []).map((output) => ({
          value: BigInt(output.value || '0'),
          scriptPublicKey: {
            scriptPublicKey: output.scriptPublicKey?.scriptPublicKey || '',
          },
          address: output.address,
        })),
        payload: tx.payload,
      }
    } catch {
      return null
    }
  }

  async getBlockDetails(hash: string): Promise<KaspaBlock | null> {
    try {
      interface ApiBlock {
        blockHash: string
        blueScore: string
        timestamp: number
        header?: {
          parentHashes?: string[]
        }
      }

      const block = await this.fetch<ApiBlock>(`/blocks/${hash}`)

      return {
        hash: block.blockHash,
        blueScore: BigInt(block.blueScore || '0'),
        timestamp: block.timestamp,
        parentHashes: block.header?.parentHashes || [],
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
    interface ApiInfo {
      networkId: string
      virtualDaaScore: string
      tipHash: string
    }

    const info = await this.fetch<ApiInfo>('/info')

    return {
      network: info.networkId,
      virtualDaaScore: BigInt(info.virtualDaaScore || '0'),
      tipHash: info.tipHash,
    }
  }
}
