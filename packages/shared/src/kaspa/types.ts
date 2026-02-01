/**
 * Kaspa Adapter Types
 *
 * Common types for Kaspa blockchain interactions.
 * Adapter implementations (Kas.fyi, direct node) will use these types.
 */

export interface KaspaTransaction {
  txid: string
  blockTime?: number // Unix timestamp in ms (if available)
  isAccepted: boolean
  acceptingBlockHash?: string
  confirmations: number
  inputs: KaspaTxInput[]
  outputs: KaspaTxOutput[]
  payload?: string // hex string
}

export interface KaspaTxInput {
  previousOutpoint: {
    transactionId: string
    index: number
  }
  signatureScript?: string
  sigOpCount?: number
}

export interface KaspaTxOutput {
  value: bigint // sompi
  scriptPublicKey: {
    scriptPublicKey: string
    version?: number
  }
  // Derived address (may be computed from scriptPublicKey)
  address?: string
}

export interface KaspaBlock {
  hash: string
  blueScore: bigint
  timestamp: number // Unix timestamp in ms
  parentHashes: string[]
}

export interface TransactionAcceptance {
  txid: string
  isAccepted: boolean
  acceptingBlockHash?: string
  confirmations: number
}

export interface AddressTransactionsOptions {
  limit?: number
  offset?: number
  cursor?: string
  includePayload?: boolean
  acceptedOnly?: boolean
}

export interface AddressTransactionsResult {
  transactions: KaspaTransaction[]
  cursor?: string // For pagination
  hasMore: boolean
}

/**
 * Kaspa Adapter Interface
 *
 * All Kaspa adapter implementations must implement this interface.
 * This allows swapping between Kas.fyi API and direct node connections.
 */
export interface KaspaAdapter {
  /**
   * Get transactions for an address
   */
  getAddressTransactions(
    address: string,
    options?: AddressTransactionsOptions
  ): Promise<AddressTransactionsResult>

  /**
   * Get acceptance status for multiple transactions
   */
  getTransactionsAcceptance(txids: string[]): Promise<TransactionAcceptance[]>

  /**
   * Get detailed transaction information
   */
  getTransactionDetails(txid: string, includePayload?: boolean): Promise<KaspaTransaction | null>

  /**
   * Get block details by hash
   */
  getBlockDetails(hash: string): Promise<KaspaBlock | null>

  /**
   * Get current network info (for health checks)
   */
  getNetworkInfo(): Promise<{
    network: string
    virtualDaaScore: bigint
    tipHash: string
  }>
}
