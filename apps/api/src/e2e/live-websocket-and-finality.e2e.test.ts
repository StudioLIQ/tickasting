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

describe('API E2E - websocket and finality edges', () => {
  beforeAll(async () => {
    process.env['DATABASE_URL'] ??= DEFAULT_DATABASE_URL
    process.env['PURCHASE_MODE'] = 'evm'
    process.env['USE_PONDER_DATA'] = 'true'
    process.env['PONDER_SCHEMA'] ??= 'public'
    process.env['WS_BROADCAST_INTERVAL_MS'] = '150'
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

  it('streams live stats and handles websocket protocol errors', async () => {
    if (!prisma) throw new Error('Prisma not initialized')

    const uniqueTag = createUniqueTag()
    const nowSeconds = Math.floor(Date.now() / 1000).toString()

    const eventRes = await requestJson<{ id: string }>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        title: `WS Event ${uniqueTag}`,
        venue: 'Realtime Hall',
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
          supplyTotal: 5,
          finalityDepth: 1,
          ticketTypes: [{ code: 'GEN', name: 'General', priceSompi: '1000000', supply: 5 }],
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

    const ws = await connectWebSocket(`${wsBaseUrl}/ws/sales/${saleId}`)

    const initialStats = await waitForWsMessage(ws, (msg) => msg['type'] === 'stats')
    const initialData = initialStats['data'] as JsonRecord
    expect(initialData['saleId']).toBe(saleId)
    expect(initialData['totalAttempts']).toBe(0)

    const askedStatsPromise = waitForWsMessage(ws, (msg) => {
      if (msg['type'] !== 'stats') return false
      const data = msg['data'] as JsonRecord
      return data['saleId'] === saleId
    })
    ws.send(JSON.stringify({ type: 'get_stats' }))
    const askedStats = await askedStatsPromise
    expect((askedStats['data'] as JsonRecord)['saleId']).toBe(saleId)

    const txid = randomHex(32).toLowerCase()
    await insertPaymentTransferRow(prisma, {
      id: `${txid}-0`,
      tokenAddress: randomHex(20).toLowerCase(),
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasury,
      value: '1000000',
      txHash: txid,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '0',
    })

    const updatedStats = await waitForWsMessage(ws, (msg) => {
      if (msg['type'] !== 'stats') return false
      const data = msg['data'] as JsonRecord
      return (
        data['saleId'] === saleId &&
        typeof data['totalAttempts'] === 'number' &&
        (data['totalAttempts'] as number) >= 1
      )
    }, 10000)
    const updatedData = updatedStats['data'] as JsonRecord
    expect(updatedData['totalAttempts']).toBeGreaterThanOrEqual(1)
    expect(updatedData['finalAttempts']).toBeGreaterThanOrEqual(1)

    const wsMyStatusPromise = waitForWsMessage(ws, (msg) => msg['type'] === 'my_status')
    ws.send(JSON.stringify({ type: 'get_my_status', txid }))
    const wsMyStatus = await wsMyStatusPromise
    const wsStatusData = wsMyStatus['data'] as JsonRecord
    expect(wsStatusData['found']).toBe(true)
    expect(wsStatusData['txid']).toBe(txid)

    const wsErrorPromise = waitForWsMessage(ws, (msg) => msg['type'] === 'error')
    ws.send('not-json-message')
    const wsError = await wsErrorPromise
    expect(wsError['message']).toBe('Invalid message')
    ws.close()
  }, 30000)

  it('keeps high-block attempts provisional until finality', async () => {
    if (!prisma) throw new Error('Prisma not initialized')

    const uniqueTag = createUniqueTag()
    const nowSeconds = Math.floor(Date.now() / 1000).toString()

    const eventRes = await requestJson<{ id: string }>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        title: `Finality Event ${uniqueTag}`,
        venue: 'Depth Arena',
      }),
    })
    expect(eventRes.status).toBe(201)
    const eventId = eventRes.body.id
    createdEventIds.push(eventId)

    const treasury = randomHex(20).toLowerCase()
    createdTreasuries.push(treasury)

    const saleRes = await requestJson<{ id: string }>(`/v1/events/${eventId}/sales`, {
      method: 'POST',
      body: JSON.stringify({
        network: 'kasplex-testnet',
        treasuryAddress: treasury,
        ticketPriceSompi: '1000000',
        supplyTotal: 1,
        finalityDepth: 1,
        ticketTypes: [{ code: 'ONE', name: 'One', priceSompi: '1000000', supply: 1 }],
      }),
    })
    expect(saleRes.status).toBe(201)
    const saleId = saleRes.body.id
    createdSaleIds.push(saleId)

    const publishRes = await requestJson<{ sale: { status: string } }>(
      `/v1/sales/${saleId}/publish`,
      { method: 'POST' }
    )
    expect(publishRes.status).toBe(200)
    expect(publishRes.body.sale.status).toBe('live')

    const provisionalTxid = randomHex(32).toLowerCase()
    await insertPaymentTransferRow(prisma, {
      id: `${provisionalTxid}-0`,
      tokenAddress: randomHex(20).toLowerCase(),
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasury,
      value: '1000000',
      txHash: provisionalTxid,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '999999999999999999',
      blockTimestamp: nowSeconds,
      logIndex: '0',
    })

    const statsRes = await requestJson<{
      totalAttempts: number
      validAttempts: number
      finalAttempts: number
      remaining: number
    }>(`/v1/sales/${saleId}/stats`)
    expect(statsRes.status).toBe(200)
    expect(statsRes.body.totalAttempts).toBe(1)
    expect(statsRes.body.validAttempts).toBe(1)
    expect(statsRes.body.finalAttempts).toBe(0)
    expect(statsRes.body.remaining).toBe(1)

    const myStatusRes = await requestJson<{
      found: boolean
      accepted: boolean
      provisionalRank: number | null
      finalRank: number | null
      isWinner: boolean
    }>(`/v1/sales/${saleId}/my-status?txid=${provisionalTxid}`)
    expect(myStatusRes.status).toBe(200)
    expect(myStatusRes.body.found).toBe(true)
    expect(myStatusRes.body.accepted).toBe(true)
    expect(myStatusRes.body.provisionalRank).toBe(1)
    expect(myStatusRes.body.finalRank).toBeNull()
    expect(myStatusRes.body.isWinner).toBe(false)

    const allocationRes = await requestJson<{
      winners: unknown[]
      merkleRoot: string | null
      losersCount: number
    }>(`/v1/sales/${saleId}/allocation`)
    expect(allocationRes.status).toBe(200)
    expect(allocationRes.body.winners).toHaveLength(0)
    expect(allocationRes.body.merkleRoot).toBeNull()
    expect(allocationRes.body.losersCount).toBe(0)

    const issueRes = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/tickets/${provisionalTxid}/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ ownerAddress: randomHex(20).toLowerCase() }),
      }
    )
    expect(issueRes.status).toBe(400)
    expect(issueRes.body.error).toContain('Not a winner')

    const finalizeRes = await requestJson<{ sale: { status: string } }>(
      `/v1/sales/${saleId}/finalize`,
      { method: 'POST' }
    )
    expect(finalizeRes.status).toBe(200)
    expect(finalizeRes.body.sale.status).toBe('finalizing')

    const commitTxid = randomHex(32).toLowerCase()
    const commitRes = await requestJson<{ commitTxid: string; merkleRoot: string | null }>(
      `/v1/sales/${saleId}/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ commitTxid }),
      }
    )
    expect(commitRes.status).toBe(200)
    expect(commitRes.body.commitTxid).toBe(commitTxid)
    expect(commitRes.body.merkleRoot).toBeNull()

    const proofRes = await requestJson<{ found: boolean }>(
      `/v1/sales/${saleId}/merkle-proof?txid=${provisionalTxid}`
    )
    expect(proofRes.status).toBe(200)
    expect(proofRes.body.found).toBe(false)
  }, 30000)
})
