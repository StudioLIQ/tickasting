'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * KasWare Wallet Interface (window.kasware)
 * Based on: https://docs.kasware.xyz/wallet/dev-base/kaspa
 */
interface KaswareProvider {
  requestAccounts: () => Promise<string[]>
  getAccounts: () => Promise<string[]>
  getNetwork: () => Promise<string>
  getPublicKey: () => Promise<string>
  getBalance: () => Promise<{ confirmed: number; unconfirmed: number; total: number }>
  sendKaspa: (
    toAddress: string,
    sompiAmount: number,
    options?: { priorityFee?: number; payload?: string }
  ) => Promise<string> // Returns txid
  on: (event: string, handler: (data: unknown) => void) => void
  removeListener: (event: string, handler: (data: unknown) => void) => void
}

declare global {
  interface Window {
    kasware?: KaswareProvider
  }
}

export interface UseKaswareResult {
  isInstalled: boolean
  isConnected: boolean
  address: string | null
  network: string | null
  balance: { confirmed: number; unconfirmed: number; total: number } | null
  connect: () => Promise<void>
  disconnect: () => void
  sendKaspa: (
    toAddress: string,
    sompiAmount: bigint,
    options?: { priorityFee?: number; payload?: string }
  ) => Promise<string>
  error: string | null
  loading: boolean
}

export function useKasware(): UseKaswareResult {
  const [isInstalled, setIsInstalled] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [network, setNetwork] = useState<string | null>(null)
  const [balance, setBalance] = useState<{
    confirmed: number
    unconfirmed: number
    total: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Check if KasWare is installed
  useEffect(() => {
    const checkInstalled = () => {
      const installed = typeof window !== 'undefined' && !!window.kasware
      setIsInstalled(installed)
    }

    // Check immediately
    checkInstalled()

    // Also check after a delay (extension might load slowly)
    const timer = setTimeout(checkInstalled, 500)

    return () => clearTimeout(timer)
  }, [])

  // Connect to wallet
  const connect = useCallback(async () => {
    if (!window.kasware) {
      setError('KasWare wallet is not installed')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const accounts = await window.kasware.requestAccounts()
      if (accounts.length > 0) {
        setAddress(accounts[0] ?? null)
        setIsConnected(true)

        // Get additional info
        const [networkName, balanceInfo] = await Promise.all([
          window.kasware.getNetwork(),
          window.kasware.getBalance(),
        ])

        setNetwork(networkName)
        setBalance(balanceInfo)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to connect'
      setError(errorMsg)
      setIsConnected(false)
    } finally {
      setLoading(false)
    }
  }, [])

  // Disconnect (just clear local state, KasWare doesn't have disconnect)
  const disconnect = useCallback(() => {
    setIsConnected(false)
    setAddress(null)
    setNetwork(null)
    setBalance(null)
  }, [])

  // Send KAS transaction
  const sendKaspa = useCallback(
    async (
      toAddress: string,
      sompiAmount: bigint,
      options?: { priorityFee?: number; payload?: string }
    ): Promise<string> => {
      if (!window.kasware) {
        throw new Error('KasWare wallet is not installed')
      }

      if (!isConnected) {
        throw new Error('Wallet not connected')
      }

      // KasWare expects number for amount
      const amount = Number(sompiAmount)
      if (!Number.isSafeInteger(amount)) {
        throw new Error('Amount too large')
      }

      const txid = await window.kasware.sendKaspa(toAddress, amount, options)
      return txid
    },
    [isConnected]
  )

  // Listen for account changes
  useEffect(() => {
    if (!window.kasware || !isConnected) return

    const handleAccountsChanged = (accounts: unknown) => {
      const accts = accounts as string[]
      if (accts.length === 0) {
        disconnect()
      } else {
        setAddress(accts[0] ?? null)
      }
    }

    const handleNetworkChanged = (network: unknown) => {
      setNetwork(network as string)
    }

    window.kasware.on('accountsChanged', handleAccountsChanged)
    window.kasware.on('networkChanged', handleNetworkChanged)

    return () => {
      window.kasware?.removeListener('accountsChanged', handleAccountsChanged)
      window.kasware?.removeListener('networkChanged', handleNetworkChanged)
    }
  }, [isConnected, disconnect])

  return {
    isInstalled,
    isConnected,
    address,
    network,
    balance,
    connect,
    disconnect,
    sendKaspa,
    error,
    loading,
  }
}
