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
let wsBaseUrl = ''

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

async function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('WebSocket connection timeout'))
    }, 5000)

    ws.addEventListener('open', () => {
      clearTimeout(timeout)
      resolve(ws)
    })

    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('WebSocket connection failed'))
    })
  })
}

async function waitForWsMessage(
  ws: WebSocket,
  predicate: (message: JsonRecord) => boolean,
  timeoutMs = 5000
): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      reject(new Error('Timed out waiting for WebSocket message'))
    }, timeoutMs)

    function onMessage(event: MessageEvent) {
      if (typeof event.data !== 'string') return

      let message: JsonRecord
      try {
        message = JSON.parse(event.data) as JsonRecord
      } catch {
        return
      }

      if (!predicate(message)) return

      clearTimeout(timeout)
      ws.removeEventListener('message', onMessage)
      resolve(message)
    }

    ws.addEventListener('message', onMessage)
  })
}

describe('API E2E - guards and error paths', () => {
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
    wsBaseUrl = `ws://127.0.0.1:${address.port}`
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

  it('enforces state machine and validation guards', async () => {
    const uniqueTag = createUniqueTag()
    const missingSaleId = randomHex(16).toLowerCase()

    const eventRes = await requestJson<{ id: string }>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        title: `E2E Guard Event ${uniqueTag}`,
        venue: 'Guard Hall',
      }),
    })
    expect(eventRes.status).toBe(201)
    const eventId = eventRes.body.id
    createdEventIds.push(eventId)

    const duplicateCodeSale = await requestJson<{ error: string }>(
      `/v1/events/${eventId}/sales`,
      {
        method: 'POST',
        body: JSON.stringify({
          network: 'kasplex-testnet',
          treasuryAddress: randomHex(20).toLowerCase(),
          ticketPriceSompi: '1000000',
          supplyTotal: 10,
          ticketTypes: [
            { code: 'DUP', name: 'Dup 1', priceSompi: '1000000', supply: 5 },
            { code: 'DUP', name: 'Dup 2', priceSompi: '1000000', supply: 5 },
          ],
        }),
      }
    )
    expect(duplicateCodeSale.status).toBe(400)
    expect(duplicateCodeSale.body.error).toContain('Duplicate ticket type codes')

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
          ticketTypes: [{ code: 'ONE', name: 'Single', priceSompi: '1000000', supply: 1 }],
        }),
      }
    )
    expect(saleRes.status).toBe(201)
    expect(saleRes.body.status).toBe('scheduled')

    const saleId = saleRes.body.id
    createdSaleIds.push(saleId)

    const finalizeScheduled = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/finalize`,
      { method: 'POST' }
    )
    expect(finalizeScheduled.status).toBe(400)
    expect(finalizeScheduled.body.error).toContain('Invalid state transition')

    const commitScheduled = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ commitTxid: randomHex(32).toLowerCase() }),
      }
    )
    expect(commitScheduled.status).toBe(400)
    expect(commitScheduled.body.error).toContain('Invalid state')

    const publishRes = await requestJson<{ sale: { status: string } }>(
      `/v1/sales/${saleId}/publish`,
      { method: 'POST' }
    )
    expect(publishRes.status).toBe(200)
    expect(publishRes.body.sale.status).toBe('live')

    const publishAgain = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/publish`,
      { method: 'POST' }
    )
    expect(publishAgain.status).toBe(400)
    expect(publishAgain.body.error).toContain('Invalid state transition')

    const addTypeAfterPublish = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/ticket-types`,
      {
        method: 'POST',
        body: JSON.stringify({
          code: 'LATE',
          name: 'Late Type',
          priceSompi: '1000000',
          supply: 1,
        }),
      }
    )
    expect(addTypeAfterPublish.status).toBe(400)
    expect(addTypeAfterPublish.body.error).toContain('Cannot add ticket types')

    const myStatusMissingTxid = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/my-status`
    )
    expect(myStatusMissingTxid.status).toBe(400)
    expect(myStatusMissingTxid.body.error).toContain('txid query parameter is required')

    const proofMissingTxid = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/merkle-proof`
    )
    expect(proofMissingTxid.status).toBe(400)
    expect(proofMissingTxid.body.error).toContain('txid query parameter is required')

    const claimForNonWinner = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/claims/sync`,
      {
        method: 'POST',
        body: JSON.stringify({
          kaspaTxid: randomHex(32).toLowerCase(),
          ticketTypeCode: 'ONE',
          claimerEvmAddress: randomHex(20).toLowerCase(),
          claimTxHash: randomHex(32).toLowerCase(),
          tokenId: '111',
          finalRank: 1,
        }),
      }
    )
    expect(claimForNonWinner.status).toBe(404)
    expect(claimForNonWinner.body.error).toContain('Winner not found')

    const invalidVerify = await requestJson<{ valid: boolean; result: string }>(
      '/v1/scans/verify',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode: 'INVALID-QR' }),
      }
    )
    expect(invalidVerify.status).toBe(200)
    expect(invalidVerify.body.valid).toBe(false)
    expect(invalidVerify.body.result).toBe('deny_invalid_ticket')

    const invalidRedeem = await requestJson<{ success: boolean; result: string }>(
      '/v1/scans/redeem',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode: 'INVALID-QR', gateId: 'gate-z' }),
      }
    )
    expect(invalidRedeem.status).toBe(200)
    expect(invalidRedeem.body.success).toBe(false)
    expect(invalidRedeem.body.result).toBe('deny_invalid_ticket')

    const ws = await connectWebSocket(`${wsBaseUrl}/ws/sales/${missingSaleId}`)
    const wsError = await waitForWsMessage(ws, (msg) => msg['type'] === 'error')
    expect(wsError['message']).toBe('Sale not found')
    ws.close()
  }, 30000)
})
