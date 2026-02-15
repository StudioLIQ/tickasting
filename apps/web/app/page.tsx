'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { getSales, type Sale } from '@/lib/api'
import { PUBLIC_PAYMENT_DECIMALS, PUBLIC_PAYMENT_SYMBOL } from '@/lib/public-runtime'

type SaleStatusFilter = 'all' | 'live' | 'scheduled' | 'finalizing' | 'finalized'

const PAYMENT_SYMBOL = PUBLIC_PAYMENT_SYMBOL
const PAYMENT_DECIMALS = PUBLIC_PAYMENT_DECIMALS

function formatTokenAmount(raw: bigint): string {
  const base = 10n ** BigInt(PAYMENT_DECIMALS)
  const whole = raw / base
  const frac = raw % base
  const fracText = frac.toString().padStart(PAYMENT_DECIMALS, '0').replace(/0+$/, '')
  return fracText.length > 0 ? `${whole.toString()}.${fracText}` : whole.toString()
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'TBA'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'TBA'
  return date.toLocaleDateString()
}

function getSaleImage(sale: Sale): string | null {
  return sale.ticketTypes?.find((tt) => tt.metadataUri)?.metadataUri ?? null
}

function getPriceRangeLabel(sale: Sale): string {
  if (!sale.ticketTypes || sale.ticketTypes.length === 0) {
    return `${formatTokenAmount(BigInt(sale.ticketPriceSompi))} ${PAYMENT_SYMBOL}`
  }
  const prices = sale.ticketTypes.map((tt) => BigInt(tt.priceSompi))
  const minPrice = prices.reduce((min, price) => (price < min ? price : min), prices[0] || 0n)
  const maxPrice = prices.reduce((max, price) => (price > max ? price : max), prices[0] || 0n)
  if (minPrice === maxPrice) {
    return `${formatTokenAmount(minPrice)} ${PAYMENT_SYMBOL}`
  }
  return `${formatTokenAmount(minPrice)} - ${formatTokenAmount(maxPrice)} ${PAYMENT_SYMBOL}`
}

function getRemainingSupplyLabel(sale: Sale): string {
  const total = sale.supplyTotal
  const ticketTypes = sale.ticketTypes ?? []
  const allHaveRemaining = ticketTypes.length > 0 && ticketTypes.every((tt) => typeof tt.remaining === 'number')
  if (!allHaveRemaining) {
    return `${total}/${total}`
  }

  const remaining = ticketTypes.reduce((sum, tt) => sum + (tt.remaining ?? 0), 0)
  return `${remaining}/${total}`
}

function statusClassName(status: string): string {
  switch (status) {
    case 'live':
      return 'bg-green-500/20 text-green-300 border-green-400/40'
    case 'finalized':
      return 'bg-blue-500/20 text-blue-300 border-blue-400/40'
    case 'finalizing':
      return 'bg-yellow-500/20 text-yellow-300 border-yellow-400/40'
    default:
      return 'bg-gray-700/60 text-gray-300 border-gray-500/40'
  }
}

export default function Home() {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<SaleStatusFilter>('all')

  useEffect(() => {
    let cancelled = false

    async function loadSales() {
      try {
        const data = await getSales()
        if (!cancelled) setSales(data.sales)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sales')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSales()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredSales = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    return sales.filter((sale) => {
      const statusMatch = statusFilter === 'all' || sale.status === statusFilter
      const keywordMatch =
        keyword.length === 0 ||
        (sale.eventTitle || '').toLowerCase().includes(keyword) ||
        sale.id.toLowerCase().includes(keyword)
      return statusMatch && keywordMatch
    })
  }, [sales, searchKeyword, statusFilter])

  const liveCount = sales.filter((sale) => sale.status === 'live').length
  const finalizedCount = sales.filter((sale) => sale.status === 'finalized').length

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-r from-gray-900 via-[#111827] to-gray-900">
          <div className="p-6 sm:p-8">
            <div className="mb-4 flex items-center gap-3">
              <Image src="/logo-mark.png" alt="Tickasting logo mark" width={56} height={56} priority />
              <div>
                <h1 className="text-3xl font-bold text-white sm:text-4xl">
                  <span className="text-kaspa-primary">Tick</span>asting
                </h1>
                <p className="text-sm text-gray-300 sm:text-base">
                  Marketplace-style ticket browsing with on-chain purchase tracking.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-gray-300">
              <span className="rounded-full border border-gray-700 bg-gray-900/60 px-3 py-1">
                Total Sales: {sales.length}
              </span>
              <span className="rounded-full border border-gray-700 bg-gray-900/60 px-3 py-1">
                Live: {liveCount}
              </span>
              <span className="rounded-full border border-gray-700 bg-gray-900/60 px-3 py-1">
                Finalized: {finalizedCount}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-500">
              <span className="rounded-full border border-gray-800 px-3 py-1">Deterministic ordering</span>
              <span className="rounded-full border border-gray-800 px-3 py-1">Merkle proofs</span>
              <span className="rounded-full border border-gray-800 px-3 py-1">Live queue</span>
            </div>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="h-fit rounded-2xl border border-gray-800 bg-gray-900/70 p-4 lg:sticky lg:top-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Filters</h2>
            <label className="mb-2 block text-xs uppercase tracking-wide text-gray-500">
              Search Event / Sale ID
            </label>
            <input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="e.g. Aurora, seed-sale..."
              className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-500"
            />
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
              {(['all', 'live', 'scheduled', 'finalizing', 'finalized'] as SaleStatusFilter[]).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                    statusFilter === status
                      ? 'border-kaspa-primary bg-kaspa-primary/15 text-kaspa-primary'
                      : 'border-gray-700 bg-gray-900/40 text-gray-200 hover:border-gray-500'
                  }`}
                >
                  {status === 'all' ? 'All Status' : status}
                </button>
              ))}
            </div>
          </aside>

          <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Ticket Sales</h2>
              <span className="text-sm text-gray-400">{filteredSales.length} results</span>
            </div>

            {loading && <div className="py-16 text-center text-gray-400">Loading sales...</div>}
            {error && !loading && <div className="py-16 text-center text-red-400">{error}</div>}

            {!loading && !error && filteredSales.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-700 p-10 text-center text-gray-400">
                No matching sales. Try a different keyword or status filter.
              </div>
            )}

            {!loading && !error && filteredSales.length > 0 && (
              <div className="space-y-3">
                {filteredSales.map((sale) => {
                  const saleImage = getSaleImage(sale)
                  return (
                    <article
                      key={sale.id}
                      className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/70 p-3 sm:grid-cols-[180px_1fr_auto]"
                    >
                      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                        {saleImage ? (
                          <img
                            src={saleImage}
                            alt={`${sale.eventTitle || 'Sale'} poster`}
                            className="h-28 w-full object-cover sm:h-full"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-28 items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 text-xs text-gray-500 sm:h-full">
                            NO IMAGE
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-white sm:text-lg">
                            {sale.eventTitle || 'Untitled Event'}
                          </h3>
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClassName(sale.status)}`}>
                            {sale.status}
                          </span>
                        </div>
                        <div className="truncate text-xs text-gray-500">{sale.id}</div>
                        <div className="mt-2 grid gap-1 text-sm text-gray-300 sm:grid-cols-2">
                          <div>
                            <span className="text-gray-500">Price</span>: {getPriceRangeLabel(sale)}
                          </div>
                          <div>
                            <span className="text-gray-500">Supply</span>: {getRemainingSupplyLabel(sale)}
                          </div>
                          <div>
                            <span className="text-gray-500">Start</span>: {formatDate(sale.startAt)}
                          </div>
                          <div>
                            <span className="text-gray-500">End</span>: {formatDate(sale.endAt)}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-row gap-2 sm:flex-col">
                        <Link
                          href={`/sales/${sale.id}`}
                          className="rounded-md bg-kaspa-primary px-3 py-2 text-center text-sm font-semibold text-black hover:bg-kaspa-primary/90"
                        >
                          Buy
                        </Link>
                        <Link
                          href={`/sales/${sale.id}/live`}
                          className="rounded-md border border-gray-700 px-3 py-2 text-center text-sm text-gray-200 hover:border-gray-500"
                        >
                          Live
                        </Link>
                        <Link
                          href={`/sales/${sale.id}/results`}
                          className="rounded-md border border-gray-700 px-3 py-2 text-center text-sm text-gray-200 hover:border-gray-500"
                        >
                          Results
                        </Link>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
