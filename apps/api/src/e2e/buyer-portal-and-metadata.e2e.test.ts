import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const DEFAULT_DATABASE_URL =
  'postgresql://tickasting:tickasting@localhost:5433/tickasting?schema=public'
const DEFAULT_TICKET_SECRET = 'dev-ticket-secret-change-in-prod'

type JsonRecord = Record<string, unknown>

let prisma: PrismaClient | null = null
let server: FastifyInstance | null = null
let baseUrl = ''

const createdEventIds: string[] = []
const createdSaleIds: string[] = []
const createdTreasuries: string[] = []

function randomHex(bytes: number): string {
  return `0x${randomBytes(bytes).toString('hex')}`
}

function createUniqueTag(): string {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function requestJson<T = JsonRecord>(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: T }> {
  if (!baseUrl) throw new Error('baseUrl is not initialized')

  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  })
  const body = (await parseJson(response)) as T
  return { status: response.status, body }
}

async function insertPaymentTransferRow(
  client: PrismaClient,
  data: {
    id: string
    tokenAddress: string
    fromAddress: string
    toAddress: string
    value: string
    txHash: string
    blockHash: string
    blockNumber: string
    blockTimestamp: string
    logIndex: string
  }
) {
  await client.$executeRawUnsafe(
    `INSERT INTO "public"."payment_transfers_onchain"
      (id, token_address, from_address, to_address, value, tx_hash, block_hash, block_number, block_timestamp, log_index)
    VALUES
      ($1, $2, $3, $4, $5::numeric, $6, $7, $8::numeric, $9::numeric, $10::numeric)`,
    data.id,
    data.tokenAddress,
    data.fromAddress,
    data.toAddress,
    data.value,
    data.txHash,
    data.blockHash,
    data.blockNumber,
    data.blockTimestamp,
    data.logIndex
  )
}

describe('API E2E - buyer portal and metadata', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] ??= DEFAULT_DATABASE_URL
    process.env['PURCHASE_MODE'] = 'evm'
    process.env['USE_PONDER_DATA'] = 'true'
    process.env['PONDER_SCHEMA'] ??= 'public'
    process.env['WS_BROADCAST_INTERVAL_MS'] = '200'
    process.env['TICKET_SECRET'] ??= DEFAULT_TICKET_SECRET

    prisma = new PrismaClient()
    await prisma.$connect()

    const { buildApiServer } = await import('../app.js')
    server = await buildApiServer({ logger: false })
    await server.listen({ host: '127.0.0.1', port: 0 })

    const address = server.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve test server address')
    }
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    if (prisma) {
      for (const saleId of createdSaleIds) {
        await prisma.$executeRawUnsafe(
          'DELETE FROM "public"."scans" WHERE ticket_id IN (SELECT id FROM "public"."tickets" WHERE sale_id = $1)',
          saleId
        )
        await prisma.$executeRawUnsafe(
          'DELETE FROM "public"."tickets" WHERE sale_id = $1',
          saleId
        )
        await prisma.$executeRawUnsafe(
          'DELETE FROM "public"."ticket_types" WHERE sale_id = $1',
          saleId
        )
        await prisma.$executeRawUnsafe(
          'DELETE FROM "public"."claims_onchain" WHERE sale_id = $1',
          saleId
        )
        await prisma.$executeRawUnsafe(
          'DELETE FROM "public"."sales" WHERE id = $1',
          saleId
        )
      }

      for (const treasury of createdTreasuries) {
        await prisma.$executeRawUnsafe(
          'DELETE FROM "public"."payment_transfers_onchain" WHERE to_address = $1',
          treasury
        )
      }

      for (const eventId of createdEventIds) {
        await prisma.$executeRawUnsafe(
          'DELETE FROM "public"."events" WHERE id = $1',
          eventId
        )
      }
    }

    if (server) {
      await server.close()
    }

    if (prisma) {
      await prisma.$disconnect()
    }
  })

  it('supports buyer sale listing, my tickets, and NFT metadata fields', async () => {
    if (!prisma) throw new Error('Prisma not initialized')

    const uniqueTag = createUniqueTag()
    const nowSeconds = Math.floor(Date.now() / 1000).toString()
    const performanceStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const performanceEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString()

    const eventRes = await requestJson<{ id: string }>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        title: `Buyer Portal ${uniqueTag}`,
        venue: 'Kas Arena',
        startAt: performanceStart,
        endAt: performanceEnd,
      }),
    })
    expect(eventRes.status).toBe(201)
    const eventId = eventRes.body.id
    createdEventIds.push(eventId)

    const treasury = randomHex(20).toLowerCase()
    createdTreasuries.push(treasury)

    const saleRes = await requestJson<{ id: string; status: string }>(
      `/v1/events/${eventId}/sales`,
      {
        method: 'POST',
        body: JSON.stringify({
          network: 'kasplex-testnet',
          treasuryAddress: treasury,
          ticketPriceSompi: '1000000',
          supplyTotal: 1,
          finalityDepth: 1,
          ticketTypes: [
            {
              code: 'VIP',
              name: 'VIP Seat',
              priceSompi: '1000000',
              supply: 1,
              perk: { section: 'A', row: '3', seatNumber: '12' },
            },
          ],
        }),
      }
    )
    expect(saleRes.status).toBe(201)
    const saleId = saleRes.body.id
    createdSaleIds.push(saleId)

    const publishRes = await requestJson<{ sale: { status: string } }>(
      `/v1/sales/${saleId}/publish`,
      { method: 'POST' }
    )
    expect(publishRes.status).toBe(200)
    expect(publishRes.body.sale.status).toBe('live')

    const salesList = await requestJson<{ sales: Array<{ id: string; eventTitle: string }> }>('/v1/sales')
    expect(salesList.status).toBe(200)
    expect(salesList.body.sales.some((sale) => sale.id === saleId)).toBe(true)

    const txWinner = randomHex(32).toLowerCase()
    await insertPaymentTransferRow(prisma, {
      id: `${txWinner}-0`,
      tokenAddress: randomHex(20).toLowerCase(),
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasury,
      value: '1000000',
      txHash: txWinner,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '0',
    })

    const ownerAddress = '0xAbCdEf0123456789aBCDef0123456789abCDef01'
    const issueRes = await requestJson<{
      ticket: { id: string; status: string }
      qrCode: string
    }>(`/v1/sales/${saleId}/tickets/${txWinner}/issue`, {
      method: 'POST',
      body: JSON.stringify({ ownerAddress }),
    })
    expect(issueRes.status).toBe(201)
    expect(issueRes.body.ticket.status).toBe('issued')
    const ticketId = issueRes.body.ticket.id
    const ticketQrCode = issueRes.body.qrCode

    const missingOwner = await requestJson<{ error: string }>('/v1/tickets')
    expect(missingOwner.status).toBe(400)

    const myTicketsRes = await requestJson<{
      ownerAddress: string
      total: number
      tickets: Array<{
        id: string
        status: string
        metadata: {
          performanceTitle: string
          performanceDate: string | null
          venue: string | null
          seat: string
        }
      }>
    }>(`/v1/tickets?ownerAddress=${encodeURIComponent(ownerAddress.toLowerCase())}`)
    expect(myTicketsRes.status).toBe(200)
    expect(myTicketsRes.body.total).toBeGreaterThanOrEqual(1)
    const myTicket = myTicketsRes.body.tickets.find((ticket) => ticket.id === ticketId)
    expect(myTicket).toBeDefined()
    expect(myTicket?.metadata.performanceTitle).toContain('Buyer Portal')
    expect(myTicket?.metadata.venue).toBe('Kas Arena')
    expect(myTicket?.metadata.performanceDate).toBe(performanceStart)
    expect(myTicket?.metadata.seat).toContain('Section A')

    const myTicketsIssuedFilter = await requestJson<{ total: number }>(
      `/v1/tickets?ownerAddress=${encodeURIComponent(ownerAddress.toLowerCase())}&status=issued`
    )
    expect(myTicketsIssuedFilter.status).toBe(200)
    expect(myTicketsIssuedFilter.body.total).toBeGreaterThanOrEqual(1)

    const transferTo = '0x90f9fE6f8A6f8E5A7D34A6DbA4d3fC552A66B902'
    const transferRes = await requestJson<{
      message: string
      ticket: { id: string; ownerAddress: string; status: string }
    }>(`/v1/tickets/${ticketId}/transfer`, {
      method: 'PATCH',
      body: JSON.stringify({ toAddress: transferTo }),
    })
    expect(transferRes.status).toBe(200)
    expect(transferRes.body.ticket.id).toBe(ticketId)
    expect(transferRes.body.ticket.ownerAddress).toBe(transferTo.toLowerCase())
    expect(transferRes.body.ticket.status).toBe('issued')

    const oldOwnerAfterTransfer = await requestJson<{ total: number }>(
      `/v1/tickets?ownerAddress=${encodeURIComponent(ownerAddress.toLowerCase())}`
    )
    expect(oldOwnerAfterTransfer.status).toBe(200)
    expect(oldOwnerAfterTransfer.body.total).toBe(0)

    const newOwnerAfterTransfer = await requestJson<{
      total: number
      tickets: Array<{ id: string }>
    }>(`/v1/tickets?ownerAddress=${encodeURIComponent(transferTo.toLowerCase())}`)
    expect(newOwnerAfterTransfer.status).toBe(200)
    expect(newOwnerAfterTransfer.body.total).toBeGreaterThanOrEqual(1)
    expect(newOwnerAfterTransfer.body.tickets.some((ticket) => ticket.id === ticketId)).toBe(true)

    const cancelRes = await requestJson<{
      message: string
      ticket: { id: string; status: string }
    }>(`/v1/tickets/${ticketId}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason: 'Buyer changed plans' }),
    })
    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.ticket.id).toBe(ticketId)
    expect(cancelRes.body.ticket.status).toBe('cancelled')

    const myTicketsCancelledFilter = await requestJson<{ total: number }>(
      `/v1/tickets?ownerAddress=${encodeURIComponent(transferTo.toLowerCase())}&status=cancelled`
    )
    expect(myTicketsCancelledFilter.status).toBe(200)
    expect(myTicketsCancelledFilter.body.total).toBeGreaterThanOrEqual(1)

    const verifyCancelled = await requestJson<{
      valid: boolean
      result: string
      message: string
    }>('/v1/scans/verify', {
      method: 'POST',
      body: JSON.stringify({ qrCode: ticketQrCode }),
    })
    expect(verifyCancelled.status).toBe(200)
    expect(verifyCancelled.body.valid).toBe(false)
    expect(verifyCancelled.body.result).toBe('deny_invalid_ticket')
    expect(verifyCancelled.body.message).toContain('cancelled')

    const transferAfterCancel = await requestJson<{ error: string }>(`/v1/tickets/${ticketId}/transfer`, {
      method: 'PATCH',
      body: JSON.stringify({ toAddress: ownerAddress }),
    })
    expect(transferAfterCancel.status).toBe(400)

    const myTicketsRedeemedFilter = await requestJson<{ total: number }>(
      `/v1/tickets?ownerAddress=${encodeURIComponent(ownerAddress.toLowerCase())}&status=redeemed`
    )
    expect(myTicketsRedeemedFilter.status).toBe(200)
    expect(myTicketsRedeemedFilter.body.total).toBe(0)

    const ticketDetail = await requestJson<{
      id: string
      metadata: {
        name: string
        attributes: Array<{ trait_type: string; value: string | number | boolean }>
        properties: {
          performanceTitle: string
          performanceDate: string | null
          venue: string | null
          seat: string
        }
      }
    }>(`/v1/tickets/${ticketId}`)
    expect(ticketDetail.status).toBe(200)
    expect(ticketDetail.body.id).toBe(ticketId)
    expect(ticketDetail.body.metadata.properties.performanceTitle).toContain('Buyer Portal')
    expect(ticketDetail.body.metadata.properties.performanceDate).toBe(performanceStart)
    expect(ticketDetail.body.metadata.properties.venue).toBe('Kas Arena')
    expect(ticketDetail.body.metadata.properties.seat).toContain('Section A')
    expect(ticketDetail.body.metadata.attributes.some((attr) => attr.trait_type === 'Performance Date')).toBe(true)
    expect(ticketDetail.body.metadata.attributes.some((attr) => attr.trait_type === 'Seat')).toBe(true)

    const metadataRes = await requestJson<{
      name: string
      attributes: Array<{ trait_type: string; value: string | number | boolean }>
      properties: {
        performanceTitle: string
        performanceDate: string | null
        venue: string | null
        seat: string
      }
    }>(`/v1/tickets/${ticketId}/metadata`)
    expect(metadataRes.status).toBe(200)
    expect(metadataRes.body.name).toContain('Buyer Portal')
    expect(metadataRes.body.properties.performanceTitle).toContain('Buyer Portal')
    expect(metadataRes.body.properties.performanceDate).toBe(performanceStart)
    expect(metadataRes.body.properties.venue).toBe('Kas Arena')
    expect(metadataRes.body.properties.seat).toContain('Section A')
    expect(metadataRes.body.attributes.some((attr) => attr.trait_type === 'Performance')).toBe(true)
    expect(metadataRes.body.attributes.some((attr) => attr.trait_type === 'Seat')).toBe(true)
  })
})
