'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useKasware } from '@/hooks/useKasware'
import { getSale, getMyStatus, type Sale, type MyStatus, type TicketType } from '@/lib/api'
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

  // Ticket type selection
  const [selectedType, setSelectedType] = useState<TicketType | null>(null)

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
        // Auto-select first ticket type if available
        if (data.ticketTypes && data.ticketTypes.length > 0) {
          setSelectedType(data.ticketTypes[0])
        }
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

    pollStatus()
    const interval = setInterval(pollStatus, 3000)
    return () => clearInterval(interval)
  }, [txid, saleId, sale])

  // Handle purchase
  const handlePurchase = useCallback(async () => {
    if (!sale || !kasware.isConnected || !kasware.address) return

    const price = selectedType ? selectedType.priceSompi : sale.ticketPriceSompi

    setPurchasing(true)
    setPowProgress(0)
    setPowAttempts(0)
    setError(null)

    try {
      let payloadHex: string | undefined

      if (!sale.fallbackEnabled) {
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

      const txHash = await kasware.sendKaspa(
        sale.treasuryAddress,
        BigInt(price),
        payloadHex ? { payload: payloadHex } : undefined
      )

      setTxid(txHash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed')
    } finally {
      setPurchasing(false)
    }
  }, [sale, kasware, selectedType])

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

  const hasTicketTypes = sale.ticketTypes && sale.ticketTypes.length > 0
  const displayPrice = selectedType
    ? Number(BigInt(selectedType.priceSompi)) / 100_000_000
    : Number(BigInt(sale.ticketPriceSompi)) / 100_000_000

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            <span className="text-kaspa-primary">Tick</span>asting
          </h1>
          {sale.eventTitle && (
            <h2 className="text-xl text-gray-300">{sale.eventTitle}</h2>
          )}
        </div>

        {/* Ticket Types */}
        {hasTicketTypes && (
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-3">Ticket Types</h3>
            <div className="grid gap-3">
              {sale.ticketTypes!.map((tt) => {
                const ttPrice = Number(BigInt(tt.priceSompi)) / 100_000_000
                const isSelected = selectedType?.id === tt.id
                const isSoldOut = tt.remaining !== undefined && tt.remaining <= 0

                return (
                  <button
                    key={tt.id}
                    onClick={() => !isSoldOut && setSelectedType(tt)}
                    disabled={isSoldOut}
                    className={`text-left p-4 rounded-lg border-2 transition-all ${
                      isSelected
                        ? 'border-kaspa-primary bg-kaspa-primary/10'
                        : isSoldOut
                          ? 'border-gray-700 bg-gray-800/50 opacity-50 cursor-not-allowed'
                          : 'border-gray-700 bg-gray-800 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-semibold text-white">
                          {tt.name}
                          <span className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                            {tt.code}
                          </span>
                        </div>
                        {tt.perk && (
                          <div className="text-xs text-gray-400 mt-1">
                            {Object.entries(tt.perk as Record<string, unknown>)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(' | ')}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-kaspa-primary font-bold">{ttPrice} KAS</div>
                        <div className="text-xs text-gray-400">
                          {isSoldOut ? (
                            <span className="text-red-400">SOLD OUT</span>
                          ) : (
                            <>
                              {tt.remaining ?? tt.supply} / {tt.supply} left
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Sale Info (collapsed if ticket types shown) */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Sale Information</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {!hasTicketTypes && (
              <div>
                <span className="text-gray-400">Price:</span>
                <span className="ml-2 text-white">{displayPrice} KAS</span>
              </div>
            )}
            <div>
              <span className="text-gray-400">Total Supply:</span>
              <span className="ml-2 text-white">{sale.supplyTotal} tickets</span>
            </div>
            <div>
              <span className="text-gray-400">Status:</span>
              <span className={`ml-2 ${sale.status === 'live' ? 'text-green-400' : 'text-gray-400'}`}>
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
            {sale.claimContractAddress && (
              <div className="col-span-2">
                <span className="text-gray-400">Contract:</span>
                <span className="ml-2 text-white font-mono text-xs">
                  {sale.claimContractAddress}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Wallet Connection */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Wallet</h3>

          {!kasware.isInstalled ? (
            <div className="text-yellow-400">
              KasWare wallet not detected. Please install it from{' '}
              <a href="https://kasware.xyz" target="_blank" rel="noopener noreferrer" className="underline">
                kasware.xyz
              </a>
            </div>
          ) : !kasware.isConnected ? (
            <button
              onClick={kasware.connect}
              disabled={kasware.loading}
              className="bg-kaspa-primary hover:bg-kaspa-primary/80 px-4 py-2 rounded font-medium disabled:opacity-50"
            >
              {kasware.loading ? 'Connecting...' : 'Connect KasWare'}
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
              <button onClick={kasware.disconnect} className="text-sm text-gray-400 hover:text-white">
                Disconnect
              </button>
            </div>
          )}
        </div>

        {/* Purchase Section */}
        {kasware.isConnected && sale.status === 'live' && !txid && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4">Purchase</h3>

            {sale.fallbackEnabled && (
              <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded text-sm text-yellow-300">
                <strong>Fallback Mode:</strong> This sale accepts transactions without PoW payload.
              </div>
            )}

            {purchasing ? (
              <div className="space-y-4">
                {sale.fallbackEnabled ? (
                  <div className="text-sm text-gray-400">Sending transaction...</div>
                ) : (
                  <>
                    <div className="text-sm text-gray-400">Computing Proof of Work...</div>
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
                Purchase{selectedType ? ` ${selectedType.name}` : ''} for {displayPrice} KAS
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
                <span className="ml-2 text-white font-mono text-xs break-all">{txid}</span>
              </div>
              {selectedType && (
                <div>
                  <span className="text-gray-400">Ticket Type:</span>
                  <span className="ml-2 text-white">{selectedType.name} ({selectedType.code})</span>
                </div>
              )}

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
                      {myStatus.isFallback && <span className="ml-1 text-xs text-yellow-400">(No PoW)</span>}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Accepted:</span>
                    <span className={`ml-2 ${myStatus.accepted ? 'text-green-400' : 'text-gray-400'}`}>
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
                      <span className="ml-2 text-kaspa-primary font-bold">#{myStatus.provisionalRank}</span>
                    </div>
                  )}
                  {myStatus.finalRank && (
                    <div>
                      <span className="text-gray-400">Final Rank:</span>
                      <span className={`ml-2 font-bold ${myStatus.isWinner ? 'text-green-400' : 'text-red-400'}`}>
                        #{myStatus.finalRank} {myStatus.isWinner ? '(WINNER!)' : '(Not in supply)'}
                      </span>
                    </div>
                  )}

                  {/* Claim Section for Winners */}
                  {myStatus.isWinner && sale.claimContractAddress && (
                    <div className="mt-4 p-4 bg-green-900/20 border border-green-700 rounded">
                      <div className="font-semibold text-green-400 mb-2">You won! Claim your ticket</div>
                      <p className="text-xs text-gray-400 mb-3">
                        Connect MetaMask to claim your ERC-721 ticket on Kasplex testnet.
                        Contract: {sale.claimContractAddress}
                      </p>
                      <button
                        className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded text-sm font-medium"
                        onClick={() => {
                          alert(
                            `Claim via MetaMask:\n\nContract: ${sale.claimContractAddress}\nFunction: claimTicket()\nTxid: ${txid}\nRank: ${myStatus.finalRank}\n\n(Full MetaMask integration coming in production)`
                          )
                        }}
                      >
                        Claim Ticket on Kasplex
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-gray-400">Waiting for transaction to be detected...</div>
              )}
            </div>
          </div>
        )}

        {/* How It Works */}
        <div className="bg-gray-800/50 rounded-lg p-6 text-sm text-gray-400">
          <h3 className="font-semibold mb-2 text-gray-300">How It Works</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Connect your KasWare wallet</li>
            {hasTicketTypes && <li>Select your preferred ticket type</li>}
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
            {sale.claimContractAddress && (
              <li>Winners claim their ERC-721 ticket on Kasplex testnet via MetaMask</li>
            )}
          </ol>
        </div>
      </div>
    </main>
  )
}
