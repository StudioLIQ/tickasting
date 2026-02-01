'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useKasware } from '@/hooks/useKasware'
import { getSale, getMyStatus, type Sale, type MyStatus } from '@/lib/api'
import { solvePow, estimateProgress } from '@/lib/pow'

interface PageProps {
  params: Promise<{ saleId: string }>
}

export default function SalePage({ params }: PageProps) {
  const { saleId } = use(params)

  const kasware = useKasware()
  const [sale, setSale] = useState<Sale | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Purchase state
  const [purchasing, setPurchasing] = useState(false)
  const [powProgress, setPowProgress] = useState(0)
  const [powAttempts, setPowAttempts] = useState(0)
  const [txid, setTxid] = useState<string | null>(null)
  const [myStatus, setMyStatus] = useState<MyStatus | null>(null)

  // Load sale data
  useEffect(() => {
    async function loadSale() {
      try {
        const data = await getSale(saleId)
        setSale(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sale')
      } finally {
        setLoading(false)
      }
    }
    loadSale()
  }, [saleId])

  // Poll my status after purchase
  useEffect(() => {
    if (!txid || !sale) return

    const pollStatus = async () => {
      try {
        const status = await getMyStatus(saleId, txid)
        setMyStatus(status)
      } catch {
        // Ignore polling errors
      }
    }

    // Poll immediately and then every 3 seconds
    pollStatus()
    const interval = setInterval(pollStatus, 3000)

    return () => clearInterval(interval)
  }, [txid, saleId, sale])

  // Handle purchase
  const handlePurchase = useCallback(async () => {
    if (!sale || !kasware.isConnected || !kasware.address) return

    setPurchasing(true)
    setPowProgress(0)
    setPowAttempts(0)
    setError(null)

    try {
      let payloadHex: string | undefined

      // Only compute PoW if fallback mode is disabled
      if (!sale.fallbackEnabled) {
        // 1. Solve PoW
        const powResult = await solvePow({
          saleId: sale.id,
          buyerAddress: kasware.address,
          difficulty: sale.powDifficulty,
          onProgress: (attempts) => {
            setPowAttempts(attempts)
            setPowProgress(estimateProgress(attempts, sale.powDifficulty))
          },
        })
        payloadHex = powResult.payloadHex
      }

      // 2. Send transaction (with or without payload)
      const txHash = await kasware.sendKaspa(
        sale.treasuryAddress,
        BigInt(sale.ticketPriceSompi),
        payloadHex ? { payload: payloadHex } : undefined
      )

      setTxid(txHash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed')
    } finally {
      setPurchasing(false)
    }
  }, [sale, kasware])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-400">Loading sale...</div>
      </main>
    )
  }

  if (error && !sale) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-red-400">{error}</div>
      </main>
    )
  }

  if (!sale) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-400">Sale not found</div>
      </main>
    )
  }

  const priceKas = Number(BigInt(sale.ticketPriceSompi)) / 100_000_000

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            <span className="text-kaspa-primary">Ghost</span>Pass
          </h1>
          {sale.eventTitle && (
            <h2 className="text-xl text-gray-300">{sale.eventTitle}</h2>
          )}
        </div>

        {/* Sale Info */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Sale Information</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Price:</span>
              <span className="ml-2 text-white">{priceKas} KAS</span>
            </div>
            <div>
              <span className="text-gray-400">Supply:</span>
              <span className="ml-2 text-white">{sale.supplyTotal} tickets</span>
            </div>
            <div>
              <span className="text-gray-400">Status:</span>
              <span
                className={`ml-2 ${
                  sale.status === 'live' ? 'text-green-400' : 'text-gray-400'
                }`}
              >
                {sale.status}
              </span>
            </div>
            <div>
              <span className="text-gray-400">PoW Difficulty:</span>
              <span className="ml-2 text-white">
                {sale.fallbackEnabled ? 'N/A (Fallback Mode)' : sale.powDifficulty}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Network:</span>
              <span className="ml-2 text-white">{sale.network}</span>
            </div>
            <div>
              <span className="text-gray-400">Finality Depth:</span>
              <span className="ml-2 text-white">{sale.finalityDepth}</span>
            </div>
          </div>
        </div>

        {/* Wallet Connection */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Wallet</h3>

          {!kasware.isInstalled ? (
            <div className="text-yellow-400">
              KasWare wallet not detected. Please install it from{' '}
              <a
                href="https://kasware.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                kasware.xyz
              </a>
            </div>
          ) : !kasware.isConnected ? (
            <button
              onClick={kasware.connect}
              disabled={kasware.loading}
              className="bg-kaspa-primary hover:bg-kaspa-primary/80 px-4 py-2 rounded font-medium disabled:opacity-50"
            >
              {kasware.loading ? 'Connecting...' : 'Connect Wallet'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="text-sm">
                <span className="text-gray-400">Address:</span>
                <span className="ml-2 text-white font-mono text-xs">
                  {kasware.address?.slice(0, 20)}...{kasware.address?.slice(-10)}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-gray-400">Network:</span>
                <span className="ml-2 text-white">{kasware.network}</span>
              </div>
              {kasware.balance && (
                <div className="text-sm">
                  <span className="text-gray-400">Balance:</span>
                  <span className="ml-2 text-white">
                    {(kasware.balance.confirmed / 100_000_000).toFixed(4)} KAS
                  </span>
                </div>
              )}
              <button
                onClick={kasware.disconnect}
                className="text-sm text-gray-400 hover:text-white"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {/* Purchase Section */}
        {kasware.isConnected && sale.status === 'live' && !txid && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4">Purchase</h3>

            {/* Fallback mode notice */}
            {sale.fallbackEnabled && (
              <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded text-sm text-yellow-300">
                <strong>Fallback Mode:</strong> This sale accepts transactions without PoW payload.
                Your wallet may not support payload - the transaction will still be processed.
              </div>
            )}

            {purchasing ? (
              <div className="space-y-4">
                {sale.fallbackEnabled ? (
                  <div className="text-sm text-gray-400">
                    Sending transaction...
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-gray-400">
                      Computing Proof of Work...
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-kaspa-primary h-2 rounded-full transition-all"
                        style={{ width: `${powProgress}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500">
                      {powAttempts.toLocaleString()} attempts ({powProgress.toFixed(1)}%)
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={handlePurchase}
                className="w-full bg-kaspa-primary hover:bg-kaspa-primary/80 px-4 py-3 rounded font-medium"
              >
                Purchase for {priceKas} KAS
              </button>
            )}

            {error && <div className="mt-4 text-red-400 text-sm">{error}</div>}
          </div>
        )}

        {/* Transaction Status */}
        {txid && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4">Your Purchase</h3>

            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-400">Transaction ID:</span>
                <span className="ml-2 text-white font-mono text-xs break-all">
                  {txid}
                </span>
              </div>

              {myStatus && myStatus.found ? (
                <>
                  <div>
                    <span className="text-gray-400">Status:</span>
                    <span
                      className={`ml-2 ${
                        myStatus.validationStatus === 'valid' || myStatus.validationStatus === 'valid_fallback'
                          ? 'text-green-400'
                          : myStatus.validationStatus === 'pending'
                            ? 'text-yellow-400'
                            : 'text-red-400'
                      }`}
                    >
                      {myStatus.validationStatus}
                      {myStatus.isFallback && (
                        <span className="ml-1 text-xs text-yellow-400">(No PoW)</span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Accepted:</span>
                    <span
                      className={`ml-2 ${myStatus.accepted ? 'text-green-400' : 'text-gray-400'}`}
                    >
                      {myStatus.accepted ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Confirmations:</span>
                    <span className="ml-2 text-white">
                      {myStatus.confirmations} / {sale.finalityDepth}
                    </span>
                  </div>
                  {myStatus.provisionalRank && (
                    <div>
                      <span className="text-gray-400">Provisional Rank:</span>
                      <span className="ml-2 text-kaspa-primary font-bold">
                        #{myStatus.provisionalRank}
                      </span>
                    </div>
                  )}
                  {myStatus.finalRank && (
                    <div>
                      <span className="text-gray-400">Final Rank:</span>
                      <span
                        className={`ml-2 font-bold ${
                          myStatus.isWinner ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        #{myStatus.finalRank}{' '}
                        {myStatus.isWinner ? '(WINNER!)' : '(Not in supply)'}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-gray-400">
                  Waiting for transaction to be detected...
                </div>
              )}
            </div>
          </div>
        )}

        {/* How It Works */}
        <div className="bg-gray-800/50 rounded-lg p-6 text-sm text-gray-400">
          <h3 className="font-semibold mb-2 text-gray-300">How It Works</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Connect your KasWare wallet</li>
            {sale.fallbackEnabled ? (
              <li>Send the exact ticket price to the treasury address</li>
            ) : (
              <>
                <li>Your browser computes a Proof of Work (anti-bot measure)</li>
                <li>Transaction is sent with the PoW payload</li>
              </>
            )}
            <li>Your rank is determined by on-chain acceptance order</li>
            <li>Winners are finalized after {sale.finalityDepth} confirmations</li>
          </ol>
          {sale.fallbackEnabled && (
            <p className="mt-3 text-yellow-400/80 text-xs">
              Note: Fallback mode is enabled. Transactions without PoW payload are accepted,
              but this provides less anti-bot protection.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
