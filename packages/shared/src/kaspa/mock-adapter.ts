/**
 * Mock Kaspa Adapter
 *
 * For testing without network access.
 */

import type {
  KaspaAdapter,
  KaspaTransaction,
  KaspaBlock,
  TransactionAcceptance,
  AddressTransactionsOptions,
  AddressTransactionsResult,
} from './types.js'

export interface MockTransaction {
  txid: string
  toAddress: string
  value: bigint
  isAccepted?: boolean
  acceptingBlockHash?: string
  confirmations?: number
  payload?: string
  blockTime?: number
}

export class MockKaspaAdapter implements KaspaAdapter {
  private transactions: Map<string, MockTransaction> = new Map()
  private blocks: Map<string, { hash: string; blueScore: bigint; timestamp: number }> = new Map()
  private addressTxIndex: Map<string, string[]> = new Map()

  /**
   * Add a mock transaction
   */
  addTransaction(tx: MockTransaction): void {
    this.transactions.set(tx.txid, tx)

    // Index by address
    const existing = this.addressTxIndex.get(tx.toAddress) || []
    if (!existing.includes(tx.txid)) {
      existing.push(tx.txid)
      this.addressTxIndex.set(tx.toAddress, existing)
    }
  }

  /**
   * Add a mock block
   */
  addBlock(hash: string, blueScore: bigint, timestamp: number): void {
    this.blocks.set(hash, { hash, blueScore, timestamp })
  }

  /**
   * Update transaction acceptance
   */
  setAccepted(txid: string, acceptingBlockHash: string, confirmations: number): void {
    const tx = this.transactions.get(txid)
    if (tx) {
      tx.isAccepted = true
      tx.acceptingBlockHash = acceptingBlockHash
      tx.confirmations = confirmations
    }
  }

  /**
   * Clear all mock data
   */
  clear(): void {
    this.transactions.clear()
    this.blocks.clear()
    this.addressTxIndex.clear()
  }

  async getAddressTransactions(
    address: string,
    options: AddressTransactionsOptions = {}
  ): Promise<AddressTransactionsResult> {
    const txids = this.addressTxIndex.get(address) || []
    const offset = options.offset ?? 0
    const limit = options.limit ?? 100

    const paginated = txids.slice(offset, offset + limit)
    const transactions: KaspaTransaction[] = []

    for (const txid of paginated) {
      const mockTx = this.transactions.get(txid)
      if (!mockTx) continue

      if (options.acceptedOnly && !mockTx.isAccepted) continue

      transactions.push({
        txid: mockTx.txid,
        blockTime: mockTx.blockTime,
        isAccepted: mockTx.isAccepted ?? false,
        acceptingBlockHash: mockTx.acceptingBlockHash,
        confirmations: mockTx.confirmations ?? 0,
        inputs: [],
        outputs: [
          {
            value: mockTx.value,
            scriptPublicKey: { scriptPublicKey: '' },
            address: mockTx.toAddress,
          },
        ],
        payload: options.includePayload ? mockTx.payload : undefined,
      })
    }

    return {
      transactions,
      hasMore: offset + limit < txids.length,
    }
  }

  async getTransactionsAcceptance(txids: string[]): Promise<TransactionAcceptance[]> {
    return txids.map((txid) => {
      const tx = this.transactions.get(txid)
      return {
        txid,
        isAccepted: tx?.isAccepted ?? false,
        acceptingBlockHash: tx?.acceptingBlockHash,
        confirmations: tx?.confirmations ?? 0,
      }
    })
  }

  async getTransactionDetails(txid: string, includePayload = true): Promise<KaspaTransaction | null> {
    const mockTx = this.transactions.get(txid)
    if (!mockTx) return null

    return {
      txid: mockTx.txid,
      blockTime: mockTx.blockTime,
      isAccepted: mockTx.isAccepted ?? false,
      acceptingBlockHash: mockTx.acceptingBlockHash,
      confirmations: mockTx.confirmations ?? 0,
      inputs: [],
      outputs: [
        {
          value: mockTx.value,
          scriptPublicKey: { scriptPublicKey: '' },
          address: mockTx.toAddress,
        },
      ],
      payload: includePayload ? mockTx.payload : undefined,
    }
  }

  async getBlockDetails(hash: string): Promise<KaspaBlock | null> {
    const block = this.blocks.get(hash)
    if (!block) return null

    return {
      hash: block.hash,
      blueScore: block.blueScore,
      timestamp: block.timestamp,
      parentHashes: [],
    }
  }

  async getNetworkInfo(): Promise<{
    network: string
    virtualDaaScore: bigint
    tipHash: string
  }> {
    return {
      network: 'testnet-mock',
      virtualDaaScore: BigInt(1000000),
      tipHash: 'mock-tip-hash',
    }
  }
}
