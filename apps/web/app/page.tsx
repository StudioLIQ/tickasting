'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getSales, type Sale } from '@/lib/api'

const PAYMENT_SYMBOL = process.env['NEXT_PUBLIC_PAYMENT_TOKEN_SYMBOL'] || 'USDC'
const PAYMENT_DECIMALS = Number(process.env['NEXT_PUBLIC_PAYMENT_TOKEN_DECIMALS'] || '6')

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
  return date.toLocaleString()
}

export default function Home() {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadSales() {
      try {
        const data = await getSales()
        if (!cancelled) {
          setSales(data.sales)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sales')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadSales()
    return () => {
      cancelled = true
    }
  }, [])

  const liveSales = useMemo(() => sales.filter((sale) => sale.status === 'live'), [sales])

  return (
    <main className="min-h-screen p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Image
                src="/logo-mark.png"
                alt="Tickasting logo mark"
                width={72}
                height={72}
                priority
              />
              <div>
                <h1 className="text-3xl font-bold sm:text-4xl">
                  <span className="text-kaspa-primary">Tick</span>asting
                </h1>
                <p className="text-sm text-gray-400 sm:text-base">
                  Buy tickets, track results, and manage your NFT tickets in one place.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="#sales"
                className="rounded-lg bg-kaspa-primary px-4 py-2 text-sm font-semibold text-black hover:bg-kaspa-primary/90"
              >
                Browse Sales
              </Link>
              <Link
                href="/my-tickets"
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:border-gray-500"
              >
                My Tickets
              </Link>
              <Link
                href="/scanner"
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:border-gray-500"
              >
                Gate Scanner
              </Link>
            </div>
          </div>
          <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg bg-gray-800/80 p-3 text-gray-300">
              <div className="text-xs uppercase tracking-wide text-gray-500">Live Sales</div>
              <div className="mt-1 text-xl font-semibold text-white">{liveSales.length}</div>
            </div>
            <div className="rounded-lg bg-gray-800/80 p-3 text-gray-300">
              <div className="text-xs uppercase tracking-wide text-gray-500">Total Sales</div>
              <div className="mt-1 text-xl font-semibold text-white">{sales.length}</div>
            </div>
            <div className="rounded-lg bg-gray-800/80 p-3 text-gray-300">
              <div className="text-xs uppercase tracking-wide text-gray-500">Network</div>
              <div className="mt-1 text-xl font-semibold text-white">Kasplex EVM</div>
            </div>
          </div>
        </header>

        <section id="sales" className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Ticket Sales</h2>
          </div>

          {loading && <div className="py-8 text-center text-gray-400">Loading sales...</div>}
          {error && !loading && <div className="py-8 text-center text-red-400">{error}</div>}

          {!loading && !error && sales.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-700 p-8 text-center text-gray-400">
              No sales found. Create and publish a sale from the organizer API first.
            </div>
          )}

          {!loading && !error && sales.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {sales.map((sale) => (
                <article key={sale.id} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{sale.eventTitle || 'Untitled Event'}</h3>
                      <div className="mt-1 text-xs text-gray-500">{sale.id}</div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        sale.status === 'live'
                          ? 'bg-green-500/20 text-green-300'
                          : sale.status === 'finalized'
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-gray-700 text-gray-300'
                      }`}
                    >
                      {sale.status}
                    </span>
                  </div>

                  <div className="grid gap-2 text-sm text-gray-300">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Price</span>
                      <span>
                        {formatTokenAmount(BigInt(sale.ticketPriceSompi))} {PAYMENT_SYMBOL}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Supply</span>
                      <span>{sale.supplyTotal}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Start</span>
                      <span>{formatDate(sale.startAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">End</span>
                      <span>{formatDate(sale.endAt)}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/sales/${sale.id}`}
                      className="rounded-md bg-kaspa-primary px-3 py-2 text-sm font-medium text-black hover:bg-kaspa-primary/90"
                    >
                      Buy / View Sale
                    </Link>
                    <Link
                      href={`/sales/${sale.id}/live`}
                      className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
                    >
                      Live Board
                    </Link>
                    <Link
                      href={`/sales/${sale.id}/results`}
                      className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
                    >
                      Results
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
