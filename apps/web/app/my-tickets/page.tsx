'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { getMyTickets, type MyTicket } from '@/lib/api'
import { useEvmWallet } from '@/hooks/useEvmWallet'

type TicketStatusFilter = 'all' | 'issued' | 'redeemed' | 'cancelled'

function formatDate(iso: string | null): string {
  if (!iso) return 'TBA'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'TBA'
  return date.toLocaleString()
}

export default function MyTicketsPage() {
  const wallet = useEvmWallet()
  const [tickets, setTickets] = useState<MyTicket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<TicketStatusFilter>('all')
  const [saleIdFilter, setSaleIdFilter] = useState('')

  const loadTickets = useCallback(async () => {
    if (!wallet.address) return

    setLoading(true)
    setError(null)
    try {
      const data = await getMyTickets(wallet.address, {
        saleId: saleIdFilter.trim() || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 100,
      })
      setTickets(data.tickets)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }, [wallet.address, saleIdFilter, statusFilter])

  useEffect(() => {
    if (!wallet.address) {
      setTickets([])
      return
    }
    void loadTickets()
  }, [wallet.address, loadTickets])

  return (
    <main className="min-h-screen p-6 sm:p-8">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">My Tickets</h1>
              <p className="text-sm text-gray-400">
                Manage your NFT tickets and metadata (seat, performance, date).
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href="/"
                className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
              >
                Home
              </Link>
              <Link
                href="/scanner"
                className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
              >
                Scanner
              </Link>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          {!wallet.isInstalled ? (
            <div className="text-sm text-yellow-300">
              EVM wallet is required to load your wallet tickets.
            </div>
          ) : !wallet.isConnected ? (
            <button
              onClick={wallet.connect}
              disabled={wallet.loading}
              className="rounded-lg bg-kaspa-primary px-4 py-2 font-semibold text-black hover:bg-kaspa-primary/90 disabled:opacity-50"
            >
              {wallet.loading ? 'Connecting...' : 'Connect Wallet'}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-gray-800 p-3 text-xs text-gray-300">
                <span className="text-gray-500">Connected address: </span>
                <span className="font-mono">{wallet.address}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as TicketStatusFilter)}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                >
                  <option value="all">All Status</option>
                  <option value="issued">Issued</option>
                  <option value="redeemed">Redeemed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <input
                  value={saleIdFilter}
                  onChange={(e) => setSaleIdFilter(e.target.value)}
                  placeholder="Filter by saleId (optional)"
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
                />
                <button
                  onClick={() => void loadTickets()}
                  className="rounded-md bg-kaspa-primary px-3 py-2 text-sm font-semibold text-black hover:bg-kaspa-primary/90"
                >
                  Refresh
                </button>
              </div>

              {error && <div className="text-sm text-red-400">{error}</div>}
              {loading && <div className="text-sm text-gray-400">Loading tickets...</div>}

              {!loading && tickets.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-700 p-6 text-sm text-gray-400">
                  No tickets found for this wallet with the current filters.
                </div>
              )}

              {!loading && tickets.length > 0 && (
                <div className="grid gap-4">
                  {tickets.map((ticket) => (
                    <article key={ticket.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-white">{ticket.metadata.performanceTitle}</h2>
                          <p className="text-xs text-gray-400">Ticket ID: {ticket.id}</p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            ticket.status === 'redeemed'
                              ? 'bg-blue-500/20 text-blue-300'
                              : ticket.status === 'issued'
                                ? 'bg-green-500/20 text-green-300'
                                : 'bg-red-500/20 text-red-300'
                          }`}
                        >
                          {ticket.status}
                        </span>
                      </div>

                      {ticket.metadata.image && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
                          <img
                            src={ticket.metadata.image}
                            alt={`${ticket.metadata.performanceTitle} poster`}
                            className="h-40 w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      )}

                      <div className="mt-3 grid gap-2 text-sm text-gray-300 sm:grid-cols-2">
                        <div>
                          <span className="text-gray-500">Performance Date: </span>
                          <span>{formatDate(ticket.metadata.performanceDate)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Venue: </span>
                          <span>{ticket.metadata.venue || 'TBA'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Seat: </span>
                          <span>{ticket.metadata.seat}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Ticket Type: </span>
                          <span>{ticket.ticketTypeName || ticket.ticketTypeCode || 'Ticket'}</span>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="rounded-md bg-kaspa-primary px-3 py-2 text-sm font-medium text-black hover:bg-kaspa-primary/90"
                        >
                          View Ticket
                        </Link>
                        <Link
                          href={`/sales/${ticket.saleId}`}
                          className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
                        >
                          Open Sale
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
