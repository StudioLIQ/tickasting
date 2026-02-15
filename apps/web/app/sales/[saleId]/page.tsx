'use client'

import { useState, useEffect, useCallback, use, useRef } from 'react'
import { useEvmWallet } from '@/hooks/useEvmWallet'
import {
  getSale,
  getMyStatus,
  getMerkleProof,
  syncClaim,
  type Sale,
  type MyStatus,
  type TicketType,
} from '@/lib/api'

interface PageProps {
  params: Promise<{ saleId: string }>
}

const PAYMENT_SYMBOL = process.env['NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL'] || 'USDC'
const PAYMENT_DECIMALS = Number(process.env['NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS'] || '6')
const KASPLEX_CHAIN_ID = Number(process.env['NEXT_PUBLIC_KASPLEX_CHAIN_ID'] || '167012')
const CLAIM_CONTRACT_ADDRESS_FALLBACK =
  process.env['NEXT_PUBLIC_TICKASTING_CONTRACT_ADDRESS'] || null

function formatTokenAmount(raw: bigint): string {
  const base = 10n ** BigInt(PAYMENT_DECIMALS)
  const whole = raw / base
  const frac = raw % base
  const fracText = frac.toString().padStart(PAYMENT_DECIMALS, '0').replace(/0+$/, '')
  return fracText.length > 0 ? `${whole.toString()}.${fracText}` : whole.toString()
}

function getSaleRemainingLabel(sale: Sale): string {
  const ticketTypes = sale.ticketTypes ?? []
  const allHaveRemaining = ticketTypes.length > 0 && ticketTypes.every((tt) => typeof tt.remaining === 'number')
  if (!allHaveRemaining) return `${sale.supplyTotal}/${sale.supplyTotal}`
  const remaining = ticketTypes.reduce((sum, tt) => sum + (tt.remaining ?? 0), 0)
  return `${remaining}/${sale.supplyTotal}`
}

export default function SalePage({ params }: PageProps) {
  const { saleId } = use(params)

  const wallet = useEvmWallet()
  const onKasplex = wallet.chainId === KASPLEX_CHAIN_ID
  const [sale, setSale] = useState<Sale | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Ticket type selection
  const [selectedType, setSelectedType] = useState<TicketType | null>(null)

  // Purchase state
  const [purchasing, setPurchasing] = useState(false)
  const [txid, setTxid] = useState<string | null>(null)
  const [myStatus, setMyStatus] = useState<MyStatus | null>(null)
  const [purchaseTicketTypeCode, setPurchaseTicketTypeCode] = useState<string | null>(null)
  const [purchaseTicketTypeName, setPurchaseTicketTypeName] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null)
  const [claimSynced, setClaimSynced] = useState(false)
  const autoClaimAttemptedTxRef = useRef<string | null>(null)

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

  useEffect(() => {
    autoClaimAttemptedTxRef.current = null
    setClaiming(false)
    setClaimError(null)
    setClaimTxHash(null)
    setClaimSynced(false)
  }, [txid])

  // Handle purchase
  const handlePurchase = useCallback(async () => {
    if (!sale || !wallet.isConnected || !wallet.address) return

    const price = selectedType ? selectedType.priceSompi : sale.ticketPriceSompi

    setPurchasing(true)
    setError(null)

    try {
      const txHash = await wallet.sendUsdcTransfer(sale.treasuryAddress, BigInt(price))

      setTxid(txHash)
      setPurchaseTicketTypeCode(selectedType?.code ?? null)
      setPurchaseTicketTypeName(selectedType?.name ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed')
    } finally {
      setPurchasing(false)
    }
  }, [sale, wallet, selectedType])

  const handleClaim = useCallback(
    async (isAuto = false) => {
      if (!sale || !txid || !wallet.address) return
      if (!myStatus?.isWinner || !myStatus.finalRank) return

      const claimContractAddress = sale.claimContractAddress || CLAIM_CONTRACT_ADDRESS_FALLBACK
      if (!claimContractAddress) {
        setClaimError('Claim contract address is not configured')
        return
      }

      const ticketTypeCode = purchaseTicketTypeCode || selectedType?.code
      if (!ticketTypeCode) {
        setClaimError('Ticket type code is missing for claim')
        return
      }

      setClaiming(true)
      setClaimError(null)

      try {
        const proof = await getMerkleProof(saleId, txid)
        if (!proof.found || !proof.finalRank || !proof.proof) {
          throw new Error('Merkle proof is not ready yet')
        }

        const claimResult = await wallet.claimTicket({
          contractAddress: claimContractAddress,
          ticketTypeCode,
          kaspaTxid: txid,
          finalRank: proof.finalRank,
          merkleProof: proof.proof.map((step) => step.hash),
        })

        setClaimTxHash(claimResult.txHash)
        if (claimResult.tokenId) {
          try {
            await syncClaim(saleId, {
              kaspaTxid: txid,
              ticketTypeCode,
              claimerEvmAddress: wallet.address,
              claimTxHash: claimResult.txHash,
              tokenId: claimResult.tokenId,
              finalRank: proof.finalRank,
            })
            setClaimSynced(true)
          } catch {
            setClaimSynced(false)
          }
        }
      } catch (err) {
        const baseMessage = err instanceof Error ? err.message : 'Claim failed'
        setClaimError(isAuto ? `Auto-claim failed: ${baseMessage}` : baseMessage)
      } finally {
        setClaiming(false)
      }
    },
    [sale, txid, wallet, myStatus, purchaseTicketTypeCode, selectedType, saleId]
  )

  useEffect(() => {
    if (!sale || !txid || !myStatus?.found || !myStatus.isWinner || !myStatus.finalRank) return
    if (claiming || claimTxHash) return
    if (autoClaimAttemptedTxRef.current === txid) return

    autoClaimAttemptedTxRef.current = txid
    void handleClaim(true)
  }, [sale, txid, myStatus, claiming, claimTxHash, handleClaim])

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
    ? formatTokenAmount(BigInt(selectedType.priceSompi))
    : formatTokenAmount(BigInt(sale.ticketPriceSompi))

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
                const ttPrice = formatTokenAmount(BigInt(tt.priceSompi))
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
                        <div className="text-kaspa-primary font-bold">{ttPrice} {PAYMENT_SYMBOL}</div>
                        <div className="text-xs text-gray-400">
                          {isSoldOut ? (
                            <span className="text-red-400">SOLD OUT</span>
                          ) : (
                            <>
                              {tt.remaining ?? tt.supply}/{tt.supply}
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
                <span className="ml-2 text-white">{displayPrice} {PAYMENT_SYMBOL}</span>
              </div>
            )}
            <div>
              <span className="text-gray-400">Supply:</span>
              <span className="ml-2 text-white">{getSaleRemainingLabel(sale)}</span>
            </div>
            <div>
              <span className="text-gray-400">Status:</span>
              <span className={`ml-2 ${sale.status === 'live' ? 'text-green-400' : 'text-gray-400'}`}>
                {sale.status}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Purchase Mode:</span>
              <span className="ml-2 text-white">EVM on-chain ordering</span>
            </div>
            <div>
              <span className="text-gray-400">Network:</span>
              <span className="ml-2 text-white">{sale.network}</span>
            </div>
            <div>
              <span className="text-gray-400">Finality Depth:</span>
              <span className="ml-2 text-white">{sale.finalityDepth}</span>
            </div>
            {(sale.claimContractAddress || CLAIM_CONTRACT_ADDRESS_FALLBACK) && (
              <div className="col-span-2">
                <span className="text-gray-400">Contract:</span>
                <span className="ml-2 text-white font-mono text-xs">
                  {sale.claimContractAddress || CLAIM_CONTRACT_ADDRESS_FALLBACK}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Purchase Section */}
        {sale.status !== 'live' && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6 text-sm text-gray-300">
            <div className="font-semibold text-white">Purchasing is not available.</div>
            <div className="mt-1 text-gray-400">
              This sale is currently <span className="text-gray-200">{sale.status}</span>. Purchases open when the sale
              is live.
            </div>
          </div>
        )}

        {!wallet.isConnected && sale.status === 'live' && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 text-sm text-yellow-200">
            Connect your wallet from the top navigation bar to purchase tickets.
          </div>
        )}

        {wallet.isConnected && sale.status === 'live' && !onKasplex && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 text-sm text-yellow-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Switch to Kasplex testnet to continue.</span>
              <button
                onClick={() => void wallet.ensureKasplexChain().catch((err) => {
                  setError(err instanceof Error ? err.message : 'Failed to switch network')
                })}
                className="rounded-md border border-yellow-400/60 px-3 py-1 text-xs text-yellow-100 hover:bg-yellow-500/10"
              >
                Switch Network
              </button>
            </div>
          </div>
        )}

        {wallet.isConnected && sale.status === 'live' && !txid && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-4">Purchase</h3>

            {purchasing ? (
              <div className="space-y-4">
                <div className="text-sm text-gray-400">
                  Sending {PAYMENT_SYMBOL} transfer on Kasplex testnet...
                </div>
              </div>
            ) : (
              <button
                onClick={handlePurchase}
                className="w-full bg-kaspa-primary hover:bg-kaspa-primary/80 px-4 py-3 rounded font-medium"
              >
                Purchase{selectedType ? ` ${selectedType.name}` : ''} for {displayPrice} {PAYMENT_SYMBOL}
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
                <span className="text-gray-400">Transaction Hash:</span>
                <span className="ml-2 text-white font-mono text-xs break-all">{txid}</span>
              </div>
              {(purchaseTicketTypeName || selectedType) && (
                <div>
                  <span className="text-gray-400">Ticket Type:</span>
                  <span className="ml-2 text-white">
                    {purchaseTicketTypeName || selectedType?.name}{' '}
                    ({purchaseTicketTypeCode || selectedType?.code})
                  </span>
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
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">On-chain:</span>
                    <span className={`ml-2 ${myStatus.accepted ? 'text-green-400' : 'text-gray-400'}`}>
                      {myStatus.accepted ? 'Included' : 'Pending'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Block Confirmations:</span>
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
                  {myStatus.isWinner && (
                    <div className="mt-4 p-4 bg-green-900/20 border border-green-700 rounded">
                      <div className="font-semibold text-green-400 mb-2">You won! Claiming your ticket...</div>
                      <p className="text-xs text-gray-400 mb-3">
                        Winner is detected. The app automatically sends claim once proof is ready.
                        Contract: {sale.claimContractAddress || CLAIM_CONTRACT_ADDRESS_FALLBACK || 'not configured'}
                      </p>
                      {claiming && (
                        <div className="mb-3 text-sm text-yellow-300">
                          Claim transaction in progress. Confirm in wallet if prompted.
                        </div>
                      )}
                      {claimTxHash && (
                        <div className="mb-3 text-xs text-green-300 break-all">
                          Claim tx: {claimTxHash}
                          {claimSynced ? ' (synced)' : ''}
                        </div>
                      )}
                      {claimError && (
                        <div className="mb-3 text-sm text-red-400">{claimError}</div>
                      )}
                      <button
                        disabled={claiming}
                        className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded text-sm font-medium"
                        onClick={() => void handleClaim(false)}
                      >
                        {claiming ? 'Claiming...' : claimTxHash ? 'Claim Again' : 'Claim Now'}
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
            <li>Connect your MetaMask wallet</li>
            {hasTicketTypes && <li>Select your preferred ticket type</li>}
            <li>Send exact {PAYMENT_SYMBOL} amount to the EVM treasury address</li>
            <li>Your rank is determined by on-chain ordering (block/log order)</li>
            <li>Winners are finalized after {sale.finalityDepth} confirmations</li>
            {(sale.claimContractAddress || CLAIM_CONTRACT_ADDRESS_FALLBACK) && (
              <li>Winners are auto-claimed on Kasplex when proof is ready</li>
            )}
          </ol>
        </div>
      </div>
    </main>
  )
}
