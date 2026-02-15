'use client'

import { useState, useEffect, use } from 'react'
import { useSaleWebSocket } from '@/hooks/useSaleWebSocket'
import { getSale, getTicketTypes, type Sale, type TicketType } from '@/lib/api'

const PAYMENT_SYMBOL = process.env['NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL'] || 'USDC'
const PAYMENT_DECIMALS = Number(process.env['NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS'] || '6')

function formatTokenAmount(raw: bigint): string {
  const base = 10n ** BigInt(PAYMENT_DECIMALS)
  const whole = raw / base
  const frac = raw % base
  const fracText = frac.toString().padStart(PAYMENT_DECIMALS, '0').replace(/0+$/, '')
  return fracText.length > 0 ? `${whole.toString()}.${fracText}` : whole.toString()
}

interface PageProps {
  params: Promise<{ saleId: string }>
}

export default function LiveDashboard({ params }: PageProps) {
  const { saleId } = use(params)

  const [sale, setSale] = useState<Sale | null>(null)
  const [ticketTypes, setTicketTypes] = useState<(TicketType & { minted: number; remaining: number })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const ws = useSaleWebSocket(saleId)

  // Load sale data + ticket types
  useEffect(() => {
    async function loadData() {
      try {
        const [saleData, ttData] = await Promise.all([
          getSale(saleId),
          getTicketTypes(saleId).catch(() => ({ ticketTypes: [] })),
        ])
        setSale(saleData)
        setTicketTypes(ttData.ticketTypes)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sale')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [saleId])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
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

  const stats = ws.stats
  const remaining = stats ? stats.remaining : sale?.supplyTotal || 0
  const supplyTotal = sale?.supplyTotal || 0
  const soldPercentage = supplyTotal > 0 ? ((supplyTotal - remaining) / supplyTotal) * 100 : 0

  return (
    <main className="min-h-screen p-8 bg-gray-900">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">
              <span className="text-kaspa-primary">Tick</span>asting Live
            </h1>
            {sale?.eventTitle && (
              <h2 className="text-xl text-gray-300 mt-1">{sale.eventTitle}</h2>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                ws.connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm text-gray-400">
              {ws.connected ? 'Live' : 'Disconnected'}
            </span>
          </div>
        </div>

        {/* Main Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Remaining"
            value={remaining.toString()}
            sublabel={`of ${supplyTotal}`}
            highlight={remaining <= 10}
          />
          <StatCard
            label="Total Attempts"
            value={stats?.totalAttempts.toString() || '0'}
          />
          <StatCard
            label="Accepted"
            value={stats?.acceptedAttempts.toString() || '0'}
            sublabel="transactions"
          />
          <StatCard
            label="Finalized"
            value={stats?.finalAttempts.toString() || '0'}
            sublabel="winners"
          />
        </div>

        {/* Progress Bar */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400">Sale Progress</span>
            <span className="text-kaspa-primary font-bold">
              {soldPercentage.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
            <div
              className="bg-kaspa-primary h-full transition-all duration-500"
              style={{ width: `${soldPercentage}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-sm text-gray-500">
            <span>{supplyTotal - remaining} sold</span>
            <span>{remaining} remaining</span>
          </div>
        </div>

        {/* Ticket Types Breakdown */}
        {ticketTypes.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold mb-4">Ticket Types</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {ticketTypes.map((tt) => {
                const pct = tt.supply > 0 ? ((tt.minted ?? 0) / tt.supply) * 100 : 0
                return (
                  <div key={tt.id} className="bg-gray-700/50 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium text-white">{tt.name}</span>
                      <span className="text-xs text-gray-400">{tt.code}</span>
                    </div>
                    <div className="text-sm text-gray-400 mb-2">
                      {(Number(BigInt(tt.priceSompi)) / 100_000_000).toFixed(2)} KAS
                    </div>
                    <div className="w-full bg-gray-600 rounded-full h-2 mb-1">
                      <div
                        className={`h-full rounded-full transition-all ${
                          tt.remaining === 0 ? 'bg-red-500' : 'bg-kaspa-primary'
                        }`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{tt.minted ?? 0} claimed</span>
                      <span>{tt.remaining ?? tt.supply} left</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Sale Status */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Sale Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-400">Status</span>
                <span
                  className={`font-medium ${
                    stats?.status === 'live'
                      ? 'text-green-400'
                      : stats?.status === 'finalizing'
                        ? 'text-yellow-400'
                        : 'text-gray-400'
                  }`}
                >
                  {stats?.status || sale?.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Network</span>
                <span className="text-white">{sale?.network}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Price</span>
                <span className="text-white">
                  {sale ? formatTokenAmount(BigInt(sale.ticketPriceSompi)) : '0'} {PAYMENT_SYMBOL}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Finality Depth</span>
                <span className="text-white">{stats?.finalityDepth || sale?.finalityDepth}</span>
              </div>
            </div>
          </div>

          {/* How It Works */}
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Queue Status</h3>
            <div className="space-y-4">
              <QueueStep
                step={1}
                label="Transactions Detected"
                count={stats?.totalAttempts || 0}
                active
              />
              <QueueStep
                step={2}
                label="Validated (Amount OK)"
                count={stats?.validAttempts || 0}
                active={(stats?.validAttempts || 0) > 0}
              />
              <QueueStep
                step={3}
                label="Accepted by Network"
                count={stats?.acceptedAttempts || 0}
                active={(stats?.acceptedAttempts || 0) > 0}
              />
              <QueueStep
                step={4}
                label="Final Winners"
                count={stats?.finalAttempts || 0}
                active={(stats?.finalAttempts || 0) > 0}
                highlight
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            Queue order is determined by on-chain EVM ordering.{' '}
            <span className="text-kaspa-primary">No server manipulation possible.</span>
          </p>
          {stats?.timestamp && (
            <p className="mt-2 text-gray-600">
              Last update: {new Date(stats.timestamp).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>
    </main>
  )
}

function StatCard({
  label,
  value,
  sublabel,
  highlight,
}: {
  label: string
  value: string
  sublabel?: string
  highlight?: boolean
}) {
  return (
    <div
      className={`bg-gray-800 rounded-lg p-4 ${highlight ? 'ring-2 ring-kaspa-primary' : ''}`}
    >
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div
        className={`text-3xl font-bold ${highlight ? 'text-kaspa-primary' : 'text-white'}`}
      >
        {value}
      </div>
      {sublabel && <div className="text-xs text-gray-500 mt-1">{sublabel}</div>}
    </div>
  )
}

function QueueStep({
  step,
  label,
  count,
  active,
  highlight,
}: {
  step: number
  label: string
  count: number
  active?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
          active
            ? highlight
              ? 'bg-kaspa-primary text-white'
              : 'bg-gray-600 text-white'
            : 'bg-gray-700 text-gray-500'
        }`}
      >
        {step}
      </div>
      <div className="flex-1">
        <div className={active ? 'text-white' : 'text-gray-500'}>{label}</div>
      </div>
      <div
        className={`font-mono ${highlight ? 'text-kaspa-primary font-bold' : 'text-gray-400'}`}
      >
        {count.toLocaleString()}
      </div>
    </div>
  )
}
