import { describe, it, expect, beforeEach } from 'vitest'
import { MockKaspaAdapter } from './mock-adapter.js'

describe('MockKaspaAdapter', () => {
  let adapter: MockKaspaAdapter

  beforeEach(() => {
    adapter = new MockKaspaAdapter()
  })

  describe('transactions', () => {
    it('should add and retrieve transactions by address', async () => {
      const address = 'kaspa:test-address'
      adapter.addTransaction({
        txid: 'tx-001',
        toAddress: address,
        value: 100_000_000n,
        payload: 'deadbeef',
      })

      const result = await adapter.getAddressTransactions(address)

      expect(result.transactions).toHaveLength(1)
      expect(result.transactions[0]?.txid).toBe('tx-001')
      expect(result.transactions[0]?.outputs[0]?.value).toBe(100_000_000n)
    })

    it('should return empty for unknown address', async () => {
      const result = await adapter.getAddressTransactions('unknown')
      expect(result.transactions).toHaveLength(0)
    })

    it('should include payload when requested', async () => {
      const address = 'kaspa:test-address'
      adapter.addTransaction({
        txid: 'tx-002',
        toAddress: address,
        value: 50_000_000n,
        payload: 'cafebabe',
      })

      const result = await adapter.getAddressTransactions(address, { includePayload: true })
      expect(result.transactions[0]?.payload).toBe('cafebabe')

      const resultWithout = await adapter.getAddressTransactions(address, { includePayload: false })
      expect(resultWithout.transactions[0]?.payload).toBeUndefined()
    })
  })

  describe('acceptance', () => {
    it('should track transaction acceptance', async () => {
      const address = 'kaspa:test-address'
      adapter.addTransaction({
        txid: 'tx-003',
        toAddress: address,
        value: 100_000_000n,
      })

      // Initially not accepted
      let acceptance = await adapter.getTransactionsAcceptance(['tx-003'])
      expect(acceptance[0]?.isAccepted).toBe(false)

      // Set as accepted
      adapter.setAccepted('tx-003', 'block-hash-123', 10)

      acceptance = await adapter.getTransactionsAcceptance(['tx-003'])
      expect(acceptance[0]?.isAccepted).toBe(true)
      expect(acceptance[0]?.acceptingBlockHash).toBe('block-hash-123')
      expect(acceptance[0]?.confirmations).toBe(10)
    })
  })

  describe('blocks', () => {
    it('should add and retrieve blocks', async () => {
      adapter.addBlock('block-001', 1000n, Date.now())

      const block = await adapter.getBlockDetails('block-001')
      expect(block).not.toBeNull()
      expect(block?.blueScore).toBe(1000n)
    })

    it('should return null for unknown block', async () => {
      const block = await adapter.getBlockDetails('unknown')
      expect(block).toBeNull()
    })
  })

  describe('network info', () => {
    it('should return mock network info', async () => {
      const info = await adapter.getNetworkInfo()
      expect(info.network).toBe('testnet-mock')
      expect(typeof info.virtualDaaScore).toBe('bigint')
    })
  })

  describe('clear', () => {
    it('should clear all data', async () => {
      const address = 'kaspa:test-address'
      adapter.addTransaction({
        txid: 'tx-004',
        toAddress: address,
        value: 100_000_000n,
      })
      adapter.addBlock('block-002', 2000n, Date.now())

      adapter.clear()

      const txResult = await adapter.getAddressTransactions(address)
      expect(txResult.transactions).toHaveLength(0)

      const block = await adapter.getBlockDetails('block-002')
      expect(block).toBeNull()
    })
  })
})
