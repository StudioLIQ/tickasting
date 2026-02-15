'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  getTicket,
  getTicketMetadata,
  type TicketDetail,
  type TicketNftMetadata,
} from '@/lib/api'

interface PageProps {
  params: Promise<{ ticketId: string }>
}

function formatDate(iso: string | null): string {
  if (!iso) return 'TBA'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'TBA'
  return date.toLocaleString()
}

export default function TicketDetailPage({ params }: PageProps) {
  const { ticketId } = use(params)
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [metadata, setMetadata] = useState<TicketNftMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [ticketData, metadataData] = await Promise.all([
          getTicket(ticketId),
          getTicketMetadata(ticketId),
        ])
        if (!cancelled) {
          setTicket(ticketData)
          setMetadata(metadataData)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load ticket')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [ticketId])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-400">Loading ticket...</div>
      </main>
    )
  }

  if (error || !ticket || !metadata) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-red-400">{error || 'Ticket not found'}</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 sm:p-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-white">{metadata.name}</h1>
              <p className="text-sm text-gray-400">Ticket ID: {ticket.id}</p>
            </div>
            <div className="flex gap-2">
              <Link
                href="/my-tickets"
                className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-gray-500"
              >
                My Tickets
              </Link>
              <Link
                href={`/sales/${ticket.saleId}`}
                className="rounded-md bg-kaspa-primary px-3 py-2 text-sm font-medium text-black hover:bg-kaspa-primary/90"
              >
                Open Sale
              </Link>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Ticket Overview</h2>
          <div className="grid gap-2 text-sm text-gray-300 sm:grid-cols-2">
            <div>
              <span className="text-gray-500">Event</span>
              <div>{ticket.eventTitle}</div>
            </div>
            <div>
              <span className="text-gray-500">Status</span>
              <div>{ticket.status}</div>
            </div>
            <div>
              <span className="text-gray-500">Ticket Type</span>
              <div>{ticket.ticketTypeName || ticket.ticketTypeCode || 'Ticket'}</div>
            </div>
            <div>
              <span className="text-gray-500">Seat</span>
              <div>{ticket.metadata.properties.seat}</div>
            </div>
            <div>
              <span className="text-gray-500">Performance Date</span>
              <div>{formatDate(ticket.metadata.properties.performanceDate)}</div>
            </div>
            <div>
              <span className="text-gray-500">Venue</span>
              <div>{ticket.metadata.properties.venue || 'TBA'}</div>
            </div>
            <div>
              <span className="text-gray-500">Issued At</span>
              <div>{formatDate(ticket.issuedAt)}</div>
            </div>
            <div>
              <span className="text-gray-500">Redeemed At</span>
              <div>{formatDate(ticket.redeemedAt)}</div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">NFT Metadata Attributes</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {metadata.attributes.map((attribute) => (
              <div key={`${attribute.trait_type}-${String(attribute.value)}`} className="rounded-lg bg-gray-800 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">{attribute.trait_type}</div>
                <div className="mt-1 text-sm text-white">{String(attribute.value)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">QR Payload</h2>
          <textarea
            readOnly
            value={ticket.qrCode}
            className="h-20 w-full rounded-lg border border-gray-700 bg-gray-950 p-3 font-mono text-xs text-gray-200"
          />
        </section>

        <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Metadata JSON</h2>
          <pre className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-950 p-3 text-xs text-gray-200">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        </section>
      </div>
    </main>
  )
}
