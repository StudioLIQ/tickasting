'use client'

import { useState, useEffect, use } from 'react'
import {
  getSale,
  getAllocation,
  getMerkleProof,
  type Sale,
  type AllocationSnapshot,
  type MerkleProofResponse,
} from '@/lib/api'

interface PageProps {
  params: Promise<{ saleId: string }>
}

export default function ResultsPage({ params }: PageProps) {
  const { saleId } = use(params)

  const [sale, setSale] = useState<Sale | null>(null)
  const [allocation, setAllocation] = useState<AllocationSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTxid, setSearchTxid] = useState('')
  const [searchResult, setSearchResult] = useState<{
    found: boolean
    rank?: number
    isWinner?: boolean
    merkleProof?: MerkleProofResponse
  } | null>(null)
  const [loadingProof, setLoadingProof] = useState(false)

  // Load data
  useEffect(() => {
    async function loadData() {
      try {
        const [saleData, allocationData] = await Promise.all([
          getSale(saleId),
          getAllocation(saleId),
        ])
        setSale(saleData)
        setAllocation(allocationData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [saleId])

  // Search handler
  const handleSearch = async () => {
    if (!allocation || !searchTxid.trim()) {
      setSearchResult(null)
      return
    }

    const winner = allocation.winners.find(
      (w) => w.txid.toLowerCase() === searchTxid.toLowerCase().trim()
    )

    if (winner) {
      setSearchResult({
        found: true,
        rank: winner.finalRank,
        isWinner: true,
      })

      // Fetch merkle proof for winners
      setLoadingProof(true)
      try {
        const proof = await getMerkleProof(saleId, searchTxid.trim())
        setSearchResult((prev) => (prev ? { ...prev, merkleProof: proof } : null))
      } catch {
        // Proof fetch failed, but we still show winner status
      } finally {
        setLoadingProof(false)
      }
    } else {
      setSearchResult({
        found: true,
        isWinner: false,
      })
    }
  }

  // Download handler
  const handleDownload = () => {
    if (!allocation) return

    const blob = new Blob([JSON.stringify(allocation, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `allocation-${saleId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-400">Loading results...</div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-red-400">{error}</div>
      </main>
    )
  }

  if (!allocation) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-400">No allocation data available</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-8 bg-gray-900">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            <span className="text-kaspa-primary">Ghost</span>Pass Results
          </h1>
          {sale?.eventTitle && (
            <h2 className="text-xl text-gray-300 mt-1">{sale.eventTitle}</h2>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-400">Winners</div>
            <div className="text-2xl font-bold text-green-400">
              {allocation.winners.length}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-400">Supply</div>
            <div className="text-2xl font-bold text-white">
              {allocation.supplyTotal}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-400">Total Attempts</div>
            <div className="text-2xl font-bold text-white">
              {allocation.totalAttempts}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-400">Losers</div>
            <div className="text-2xl font-bold text-red-400">
              {allocation.losersCount}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h3 className="text-lg font-semibold mb-4">Check Your Transaction</h3>
          <div className="flex gap-4">
            <input
              type="text"
              value={searchTxid}
              onChange={(e) => setSearchTxid(e.target.value)}
              placeholder="Enter your transaction ID"
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white placeholder-gray-400"
            />
            <button
              onClick={handleSearch}
              className="bg-kaspa-primary hover:bg-kaspa-primary/80 px-6 py-2 rounded font-medium"
            >
              Search
            </button>
          </div>
          {searchResult && (
            <div className="mt-4">
              {searchResult.isWinner ? (
                <div>
                  <div className="text-green-400 font-bold mb-2">
                    Congratulations! You are a winner at rank #{searchResult.rank}!
                  </div>
                  {loadingProof && (
                    <div className="text-gray-400 text-sm">Loading merkle proof...</div>
                  )}
                  {searchResult.merkleProof?.found && (
                    <div className="mt-3 p-3 bg-gray-700/50 rounded text-sm">
                      <div className="text-gray-300 font-medium mb-2">Merkle Proof</div>
                      <div className="space-y-1 text-gray-400 font-mono text-xs">
                        <div>
                          <span className="text-gray-500">Root:</span>{' '}
                          {searchResult.merkleProof.merkleRoot?.slice(0, 16)}...
                        </div>
                        <div>
                          <span className="text-gray-500">Proof steps:</span>{' '}
                          {searchResult.merkleProof.proof?.length ?? 0}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-red-400">
                  Sorry, this transaction is not in the winners list.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Winners Table */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Winners</h3>
            <button
              onClick={handleDownload}
              className="text-sm text-kaspa-primary hover:underline"
            >
              Download allocation.json
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-3 pr-4">Rank</th>
                  <th className="pb-3 pr-4">Transaction ID</th>
                  <th className="pb-3 pr-4">Block Hash</th>
                  <th className="pb-3">Blue Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {allocation.winners.map((winner) => (
                  <tr key={winner.txid}>
                    <td className="py-3 pr-4 text-kaspa-primary font-bold">
                      #{winner.finalRank}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-300">
                      {winner.txid.slice(0, 16)}...{winner.txid.slice(-8)}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-gray-400">
                      {winner.acceptingBlockHash?.slice(0, 12)}...
                    </td>
                    <td className="py-3 text-gray-400">
                      {winner.acceptingBlueScore}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {allocation.winners.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              No winners yet. Results will appear when transactions are finalized.
            </div>
          )}
        </div>

        {/* Merkle Commit Info */}
        {(allocation.merkleRoot || allocation.commitTxid) && (
          <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold text-emerald-400 mb-4">
              Tamper-Proof Commitment
            </h3>
            <div className="space-y-3 text-sm">
              {allocation.merkleRoot && (
                <div>
                  <span className="text-gray-400">Merkle Root:</span>
                  <div className="font-mono text-xs text-gray-300 mt-1 break-all bg-gray-800/50 p-2 rounded">
                    {allocation.merkleRoot}
                  </div>
                </div>
              )}
              {allocation.commitTxid && (
                <div>
                  <span className="text-gray-400">Commit Transaction:</span>
                  <div className="font-mono text-xs mt-1">
                    <a
                      href={`https://kas.fyi/transaction/${allocation.commitTxid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-kaspa-primary hover:underline break-all"
                    >
                      {allocation.commitTxid}
                    </a>
                  </div>
                </div>
              )}
              <p className="text-gray-500 text-xs mt-3">
                The merkle root is a cryptographic commitment of all winners.
                {allocation.commitTxid && (
                  <> It has been permanently recorded on the Kaspa blockchain.</>
                )}
                {' '}Any change to the winners list would produce a different merkle root.
              </p>
            </div>
          </div>
        )}

        {/* Ordering Info */}
        <div className="bg-gray-800/50 rounded-lg p-6 text-sm">
          <h3 className="font-semibold mb-3">Ordering Rules</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-400">
            <div>
              <span className="text-gray-500">Primary Key:</span>
              <span className="ml-2">{allocation.orderingRule.primary}</span>
            </div>
            <div>
              <span className="text-gray-500">Tie-breaker:</span>
              <span className="ml-2">{allocation.orderingRule.tiebreaker}</span>
            </div>
            <div>
              <span className="text-gray-500">Finality Depth:</span>
              <span className="ml-2">{allocation.finalityDepth} confirmations</span>
            </div>
            <div>
              <span className="text-gray-500">Generated:</span>
              <span className="ml-2">
                {new Date(allocation.generatedAt).toLocaleString()}
              </span>
            </div>
          </div>
          <p className="mt-4 text-gray-500">
            The ordering is deterministic and can be independently verified using
            on-chain data. No server manipulation is possible.
          </p>
        </div>
      </div>
    </main>
  )
}
