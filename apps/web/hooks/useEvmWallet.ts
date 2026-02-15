'use client'

import { useState, useEffect, useCallback } from 'react'

interface EvmProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
  on?: (event: string, handler: (data: unknown) => void) => void
  removeListener?: (event: string, handler: (data: unknown) => void) => void
  isMetaMask?: boolean
  isRabby?: boolean
  isCoinbaseWallet?: boolean
  isTrust?: boolean
  isBraveWallet?: boolean
  providers?: EvmProvider[]
}

declare global {
  interface Window {
    ethereum?: EvmProvider
  }
}

const PAYMENT_TOKEN_ADDRESS =
  process.env['NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS'] ||
  '0x593Cd4124ffE9D11B3114259fbC170a5759E0f54'
const KASPLEX_CHAIN_ID = Number(process.env['NEXT_PUBLIC_KASPLEX_CHAIN_ID'] || '167012')
const KASPLEX_CHAIN_ID_HEX = `0x${KASPLEX_CHAIN_ID.toString(16)}`
const KASPLEX_RPC_URL = 'https://rpc.kasplextest.xyz'
const KASPLEX_EXPLORER_URL =
  process.env['NEXT_PUBLIC_EVM_EXPLORER_URL'] || 'https://explorer.testnet.kasplextest.xyz'
const WALLET_SYNC_EVENT = 'tickasting:wallet-sync'

interface EvmRequestError extends Error {
  code?: number
}

function padHex(value: string): string {
  return value.padStart(64, '0')
}

function encodeErc20Transfer(to: string, amount: bigint): string {
  const methodId = 'a9059cbb'
  const toArg = padHex(to.toLowerCase().replace(/^0x/, ''))
  const valueArg = padHex(amount.toString(16))
  return `0x${methodId}${toArg}${valueArg}`
}

function encodeErc20BalanceOf(address: string): string {
  const methodId = '70a08231'
  const ownerArg = padHex(address.toLowerCase().replace(/^0x/, ''))
  return `0x${methodId}${ownerArg}`
}

function parseHexToBigInt(raw: unknown): bigint {
  if (typeof raw !== 'string') return 0n
  if (!raw.startsWith('0x')) return 0n
  if (raw === '0x') return 0n
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}

function detectWalletLabel(provider: EvmProvider): string {
  if (provider.isMetaMask) return 'MetaMask'
  if (provider.isRabby) return 'Rabby'
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet'
  if (provider.isTrust) return 'Trust Wallet'
  if (provider.isBraveWallet) return 'Brave Wallet'
  return 'Injected EVM Wallet'
}

function emitWalletSyncEvent() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(WALLET_SYNC_EVENT))
}

function getInjectedProvider(): EvmProvider | null {
  if (typeof window === 'undefined') return null
  const provider = window.ethereum
  if (!provider) return null

  if (Array.isArray(provider.providers) && provider.providers.length > 0) {
    return provider.providers.find((p) => p.isMetaMask) || provider.providers[0] || null
  }

  return provider
}

export interface UseEvmWalletResult {
  isInstalled: boolean
  isConnected: boolean
  address: string | null
  chainId: number | null
  walletLabel: string | null
  kasBalanceWei: bigint | null
  usdcBalanceRaw: bigint | null
  balancesLoading: boolean
  balanceError: string | null
  loading: boolean
  error: string | null
  connect: () => Promise<void>
  requestAccountSelection: () => Promise<void>
  disconnect: () => void
  refreshBalances: () => Promise<void>
  ensureKasplexChain: () => Promise<void>
  sendUsdcTransfer: (toAddress: string, amount: bigint) => Promise<string>
}

export function useEvmWallet(): UseEvmWalletResult {
  const [isInstalled, setIsInstalled] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [walletLabel, setWalletLabel] = useState<string | null>(null)
  const [kasBalanceWei, setKasBalanceWei] = useState<bigint | null>(null)
  const [usdcBalanceRaw, setUsdcBalanceRaw] = useState<bigint | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsInstalled(getInjectedProvider() !== null)
  }, [])

  const syncWalletState = useCallback(async () => {
    const provider = getInjectedProvider()
    if (!provider) return

    const [accountsRaw, chainIdRaw] = await Promise.all([
      provider.request({ method: 'eth_accounts' }),
      provider.request({ method: 'eth_chainId' }),
    ])
    const accounts = accountsRaw as string[]
    const chainIdHex = chainIdRaw as string
    const nextChainId = parseInt(chainIdHex, 16)

    setAddress(accounts[0]?.toLowerCase() || null)
    setIsConnected(accounts.length > 0)
    setChainId(Number.isFinite(nextChainId) ? nextChainId : null)
    setWalletLabel(detectWalletLabel(provider))
  }, [])

  const refreshBalances = useCallback(async () => {
    const provider = getInjectedProvider()
    if (!provider || !address) {
      setKasBalanceWei(null)
      setUsdcBalanceRaw(null)
      setBalanceError(null)
      return
    }

    setBalancesLoading(true)
    setBalanceError(null)
    try {
      let nextKas: bigint | null = null
      let nextUsdc: bigint | null = null
      const errors: string[] = []

      try {
        const kasRaw = await provider.request({
          method: 'eth_getBalance',
          params: [address, 'latest'],
        })
        nextKas = parseHexToBigInt(kasRaw)
      } catch (err) {
        nextKas = null
        errors.push(err instanceof Error ? err.message : 'Failed to load KAS balance')
      }

      try {
        const usdcRaw = await provider.request({
          method: 'eth_call',
          params: [{ to: PAYMENT_TOKEN_ADDRESS, data: encodeErc20BalanceOf(address) }, 'latest'],
        })
        nextUsdc = parseHexToBigInt(usdcRaw)
      } catch (err) {
        nextUsdc = null
        errors.push(err instanceof Error ? err.message : 'Failed to load USDC balance')
      }

      setKasBalanceWei(nextKas)
      setUsdcBalanceRaw(nextUsdc)
      setBalanceError(errors.length > 0 ? errors.join(' / ') : null)
    } catch (err) {
      setKasBalanceWei(null)
      setUsdcBalanceRaw(null)
      setBalanceError(err instanceof Error ? err.message : 'Failed to load balances')
    } finally {
      setBalancesLoading(false)
    }
  }, [address])

  const connect = useCallback(async () => {
    const provider = getInjectedProvider()
    if (!provider) {
      setError('EVM wallet is required')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await provider.request({ method: 'eth_requestAccounts' })
      await syncWalletState()
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: KASPLEX_CHAIN_ID_HEX }],
      }).catch(async (switchErr: unknown) => {
        const err = switchErr as EvmRequestError
        if (err.code !== 4902) throw err
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: KASPLEX_CHAIN_ID_HEX,
              chainName: 'Kasplex Testnet',
              rpcUrls: [KASPLEX_RPC_URL],
              blockExplorerUrls: [KASPLEX_EXPLORER_URL],
              nativeCurrency: {
                name: 'Kaspa',
                symbol: 'KAS',
                decimals: 18,
              },
            },
          ],
        })
      })
      await syncWalletState()
      emitWalletSyncEvent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet')
    } finally {
      setLoading(false)
    }
  }, [syncWalletState])

  const requestAccountSelection = useCallback(async () => {
    const provider = getInjectedProvider()
    if (!provider) {
      setError('EVM wallet is required')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await provider.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      }).catch(() => null)
      await provider.request({ method: 'eth_requestAccounts' })
      await syncWalletState()
      emitWalletSyncEvent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch wallet')
    } finally {
      setLoading(false)
    }
  }, [syncWalletState])

  const disconnect = useCallback(() => {
    setIsConnected(false)
    setAddress(null)
    setChainId(null)
    setWalletLabel(null)
    setKasBalanceWei(null)
    setUsdcBalanceRaw(null)
    setBalanceError(null)
    setError(null)
    emitWalletSyncEvent()
  }, [])

  const ensureKasplexChain = useCallback(async () => {
    const provider = getInjectedProvider()
    if (!provider) throw new Error('EVM wallet is required')

    const chainIdRaw = (await provider.request({ method: 'eth_chainId' })) as string
    if (parseInt(chainIdRaw, 16) === KASPLEX_CHAIN_ID) return

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: KASPLEX_CHAIN_ID_HEX }],
      })
    } catch (switchErr) {
      const err = switchErr as EvmRequestError
      if (err.code !== 4902) throw err

      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: KASPLEX_CHAIN_ID_HEX,
            chainName: 'Kasplex Testnet',
            rpcUrls: [KASPLEX_RPC_URL],
            blockExplorerUrls: [KASPLEX_EXPLORER_URL],
            nativeCurrency: {
              name: 'Kaspa',
              symbol: 'KAS',
              decimals: 18,
            },
          },
        ],
      })
    }
    await syncWalletState()
  }, [syncWalletState])

  const sendUsdcTransfer = useCallback(
    async (toAddress: string, amount: bigint): Promise<string> => {
      const provider = getInjectedProvider()
      if (!provider) throw new Error('EVM wallet is required')
      if (!address) throw new Error('Wallet not connected')
      if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
        throw new Error('Invalid EVM treasury address')
      }
      await ensureKasplexChain()

      const data = encodeErc20Transfer(toAddress, amount)
      const txHash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: address,
            to: PAYMENT_TOKEN_ADDRESS,
            value: '0x0',
            data,
          },
        ],
      })) as string

      return txHash.toLowerCase()
    },
    [address, ensureKasplexChain]
  )

  useEffect(() => {
    const provider = getInjectedProvider()
    if (!provider) return

    void syncWalletState()

    const handleAccountsChanged = (accounts: unknown) => {
      const list = accounts as string[]
      setAddress(list[0]?.toLowerCase() || null)
      setIsConnected(list.length > 0)
      emitWalletSyncEvent()
    }
    const handleChainChanged = (chainIdHex: unknown) => {
      const parsed = parseInt(chainIdHex as string, 16)
      setChainId(Number.isFinite(parsed) ? parsed : null)
      emitWalletSyncEvent()
    }
    const handleWalletSync = () => {
      void syncWalletState()
    }

    provider.on?.('accountsChanged', handleAccountsChanged)
    provider.on?.('chainChanged', handleChainChanged)
    window.addEventListener(WALLET_SYNC_EVENT, handleWalletSync)
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
      window.removeEventListener(WALLET_SYNC_EVENT, handleWalletSync)
    }
  }, [syncWalletState])

  useEffect(() => {
    if (!isConnected || !address) {
      setKasBalanceWei(null)
      setUsdcBalanceRaw(null)
      setBalanceError(null)
      return
    }

    void refreshBalances()
    const interval = setInterval(() => {
      void refreshBalances()
    }, 15000)
    return () => clearInterval(interval)
  }, [isConnected, address, chainId, refreshBalances])

  return {
    isInstalled,
    isConnected,
    address,
    chainId,
    walletLabel,
    kasBalanceWei,
    usdcBalanceRaw,
    balancesLoading,
    balanceError,
    loading,
    error,
    connect,
    requestAccountSelection,
    disconnect,
    refreshBalances,
    ensureKasplexChain,
    sendUsdcTransfer,
  }
}
