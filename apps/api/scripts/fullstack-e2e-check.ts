import { randomBytes } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'

type JsonRecord = Record<string, unknown>

const API_BASE_URL = process.env['FULLSTACK_API_URL'] || 'http://127.0.0.1:4001'
const WEB_BASE_URL = process.env['FULLSTACK_WEB_URL'] || 'http://127.0.0.1:3000'
const PONDER_BASE_URL = process.env['FULLSTACK_PONDER_URL'] || 'http://127.0.0.1:42069'

const prisma = new PrismaClient()

function randomHex(bytes: number): string {
  return `0x${randomBytes(bytes).toString('hex')}`
}

function nowUnixSecondsString(): string {
  return Math.floor(Date.now() / 1000).toString()
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
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })
  const body = (await parseJson(response)) as T
  return { status: response.status, body }
}

async function waitFor(
  label: string,
  check: () => Promise<boolean>,
  timeoutMs = 120000,
  intervalMs = 500
) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return
    } catch {
      // Retry until timeout.
    }
    await sleep(intervalMs)
  }

  throw new Error(`Timeout waiting for ${label}`)
}

async function waitForHttpJson(
  url: string,
  predicate: (status: number, body: unknown) => boolean
) {
  await waitFor(url, async () => {
    const response = await fetch(url)
    const body = await parseJson(response)
    return predicate(response.status, body)
  })
}

async function waitForHttpText(url: string, predicate: (status: number, text: string) => boolean) {
  await waitFor(url, async () => {
    const response = await fetch(url)
    const text = await response.text()
    return predicate(response.status, text)
  })
}

async function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error(`WebSocket timeout: ${url}`))
    }, 10000)

    ws.addEventListener('open', () => {
      clearTimeout(timeout)
      resolve(ws)
    })
    ws.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket connect failed: ${url}`))
    })
  })
}

async function waitForWsMessage(
  ws: WebSocket,
  predicate: (msg: JsonRecord) => boolean,
  timeoutMs = 10000
): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      reject(new Error('WebSocket message timeout'))
    }, timeoutMs)

    function onMessage(event: MessageEvent) {
      if (typeof event.data !== 'string') return

      let msg: JsonRecord
      try {
        msg = JSON.parse(event.data) as JsonRecord
      } catch {
        return
      }

      if (!predicate(msg)) return

      clearTimeout(timeout)
      ws.removeEventListener('message', onMessage)
      resolve(msg)
    }

    ws.addEventListener('message', onMessage)
  })
}

async function insertPaymentTransferRow(data: {
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
}) {
  await prisma.$executeRawUnsafe(
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

async function main() {
  const created: {
    eventId?: string
    saleId?: string
    treasury?: string
  } = {}

  try {
    console.log('[fullstack] waiting for API')
    await waitForHttpJson(`${API_BASE_URL}/health`, (status, body) => {
      if (status !== 200) return false
      const json = body as JsonRecord
      return json['status'] === 'ok' && json['purchaseMode'] === 'evm'
    })

    console.log('[fullstack] waiting for Ponder')
    await waitForHttpJson(`${PONDER_BASE_URL}/health`, (status) => status === 200)
    await waitForHttpJson(`${PONDER_BASE_URL}/status`, (status, body) => {
      if (status !== 200) return false
      return typeof body === 'object' && body !== null
    })

    console.log('[fullstack] waiting for Web')
    await waitForHttpText(`${WEB_BASE_URL}/`, (status, text) => {
      return status === 200 && text.includes('Tickasting')
    })

    await prisma.$connect()

    const uniqueTag = `${Date.now()}-${randomBytes(3).toString('hex')}`
    const nowSeconds = nowUnixSecondsString()
    const treasury = randomHex(20).toLowerCase()

    const createdEvent = await requestJson<{ id: string }>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        title: `Fullstack Event ${uniqueTag}`,
        venue: 'Integration Arena',
      }),
    })
    if (createdEvent.status !== 201) throw new Error(`event create failed: ${createdEvent.status}`)
    created.eventId = createdEvent.body.id
    created.treasury = treasury

    const createdSale = await requestJson<{ id: string; status: string }>(
      `/v1/events/${created.eventId}/sales`,
      {
        method: 'POST',
        body: JSON.stringify({
          network: 'kasplex-testnet',
          treasuryAddress: treasury,
          ticketPriceSompi: '1000000',
          supplyTotal: 2,
          finalityDepth: 1,
          ticketTypes: [
            { code: 'VIP', name: 'VIP', priceSompi: '1000000', supply: 1 },
            { code: 'GEN', name: 'General', priceSompi: '1000000', supply: 1 },
          ],
        }),
      }
    )
    if (createdSale.status !== 201) throw new Error(`sale create failed: ${createdSale.status}`)
    if (createdSale.body.status !== 'scheduled') throw new Error('sale not scheduled')
    created.saleId = createdSale.body.id

    const publish = await requestJson<{ sale: { status: string } }>(
      `/v1/sales/${created.saleId}/publish`,
      { method: 'POST' }
    )
    if (publish.status !== 200 || publish.body.sale.status !== 'live') {
      throw new Error('sale publish failed')
    }

    const txWinner1 = randomHex(32).toLowerCase()
    const txWinner2 = randomHex(32).toLowerCase()
    const txLoser = randomHex(32).toLowerCase()

    await insertPaymentTransferRow({
      id: `${txWinner1}-0`,
      tokenAddress: randomHex(20).toLowerCase(),
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasury,
      value: '1000000',
      txHash: txWinner1,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '0',
    })
    await insertPaymentTransferRow({
      id: `${txWinner2}-1`,
      tokenAddress: randomHex(20).toLowerCase(),
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasury,
      value: '1000000',
      txHash: txWinner2,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '1',
    })
    await insertPaymentTransferRow({
      id: `${txLoser}-2`,
      tokenAddress: randomHex(20).toLowerCase(),
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasury,
      value: '1000000',
      txHash: txLoser,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '2',
    })

    await waitFor(
      'sale stats with 3 attempts',
      async () => {
        const stats = await requestJson<{
          totalAttempts: number
          finalAttempts: number
          remaining: number
        }>(`/v1/sales/${created.saleId}/stats`)
        return (
          stats.status === 200 &&
          stats.body.totalAttempts === 3 &&
          stats.body.finalAttempts === 3 &&
          stats.body.remaining === 0
        )
      },
      20000
    )

    const allocation = await requestJson<{ winners: Array<{ txid: string }> }>(
      `/v1/sales/${created.saleId}/allocation`
    )
    if (allocation.status !== 200) throw new Error('allocation request failed')
    if (allocation.body.winners.length !== 2) throw new Error('allocation winners mismatch')
    if (allocation.body.winners[0]?.txid !== txWinner1) throw new Error('winner #1 mismatch')
    if (allocation.body.winners[1]?.txid !== txWinner2) throw new Error('winner #2 mismatch')

    const ws = await connectWebSocket(`${API_BASE_URL.replace('http', 'ws')}/ws/sales/${created.saleId}`)
    const wsStats = await waitForWsMessage(ws, (msg) => msg['type'] === 'stats')
    if ((wsStats['data'] as JsonRecord)['saleId'] !== created.saleId) {
      throw new Error('ws stats saleId mismatch')
    }
    const wsPongPromise = waitForWsMessage(ws, (msg) => msg['type'] === 'pong')
    ws.send(JSON.stringify({ type: 'ping' }))
    await wsPongPromise

    const wsMyStatusPromise = waitForWsMessage(ws, (msg) => msg['type'] === 'my_status')
    ws.send(JSON.stringify({ type: 'get_my_status', txid: txWinner1 }))
    const wsMyStatus = await wsMyStatusPromise
    if ((wsMyStatus['data'] as JsonRecord)['found'] !== true) {
      throw new Error('ws my_status found mismatch')
    }
    ws.close()

    const owner = randomHex(20).toLowerCase()
    const issue = await requestJson<{ qrCode: string; ticket: { id: string } }>(
      `/v1/sales/${created.saleId}/tickets/${txWinner1}/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ ownerAddress: owner }),
      }
    )
    if (issue.status !== 201) throw new Error('ticket issue failed')
    const issuedTicketId = issue.body.ticket.id

    const myTickets = await requestJson<{
      total: number
      tickets: Array<{ id: string; metadata: { seat: string; performanceTitle: string } }>
    }>(`/v1/tickets?ownerAddress=${encodeURIComponent(owner)}`)
    if (myTickets.status !== 200) throw new Error('my tickets request failed')
    if (myTickets.body.total < 1) throw new Error('my tickets should include issued ticket')
    const myTicket = myTickets.body.tickets.find((ticket) => ticket.id === issuedTicketId)
    if (!myTicket) throw new Error('issued ticket missing from my tickets')
    if (!myTicket.metadata.performanceTitle) throw new Error('metadata.performanceTitle missing')
    if (!myTicket.metadata.seat) throw new Error('metadata.seat missing')

    const nftMetadata = await requestJson<{
      name: string
      attributes: Array<{ trait_type: string; value: string | number | boolean }>
      properties: { performanceTitle: string; seat: string }
    }>(`/v1/tickets/${issuedTicketId}/metadata`)
    if (nftMetadata.status !== 200) throw new Error('ticket metadata endpoint failed')
    if (!nftMetadata.body.name) throw new Error('ticket metadata name missing')
    if (!nftMetadata.body.properties.performanceTitle) {
      throw new Error('ticket metadata properties.performanceTitle missing')
    }
    if (!nftMetadata.body.properties.seat) {
      throw new Error('ticket metadata properties.seat missing')
    }
    if (!nftMetadata.body.attributes.some((attr) => attr.trait_type === 'Performance Date')) {
      throw new Error('ticket metadata Performance Date attribute missing')
    }

    const verify = await requestJson<{ valid: boolean; result: string }>('/v1/scans/verify', {
      method: 'POST',
      body: JSON.stringify({ qrCode: issue.body.qrCode }),
    })
    if (verify.status !== 200 || verify.body.valid !== true || verify.body.result !== 'ok') {
      throw new Error('scanner verify failed')
    }

    const redeem = await requestJson<{ success: boolean; result: string }>('/v1/scans/redeem', {
      method: 'POST',
      body: JSON.stringify({ qrCode: issue.body.qrCode, gateId: 'fullstack-gate' }),
    })
    if (redeem.status !== 200 || redeem.body.success !== true || redeem.body.result !== 'ok') {
      throw new Error('scanner redeem failed')
    }

    const doubleRedeem = await requestJson<{ success: boolean; result: string }>(
      '/v1/scans/redeem',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode: issue.body.qrCode, gateId: 'fullstack-gate' }),
      }
    )
    if (
      doubleRedeem.status !== 200 ||
      doubleRedeem.body.success !== false ||
      doubleRedeem.body.result !== 'deny_already_redeemed'
    ) {
      throw new Error('double redeem guard failed')
    }

    const salePage = await fetch(`${WEB_BASE_URL}/sales/${created.saleId}`)
    const salePageText = await salePage.text()
    if (salePage.status !== 200 || !salePageText.toLowerCase().includes('<html')) {
      throw new Error('web sale page failed')
    }

    const livePage = await fetch(`${WEB_BASE_URL}/sales/${created.saleId}/live`)
    const livePageText = await livePage.text()
    if (livePage.status !== 200 || !livePageText.toLowerCase().includes('<html')) {
      throw new Error('web live page failed')
    }

    const resultsPage = await fetch(`${WEB_BASE_URL}/sales/${created.saleId}/results`)
    const resultsPageText = await resultsPage.text()
    if (resultsPage.status !== 200 || !resultsPageText.toLowerCase().includes('<html')) {
      throw new Error('web results page failed')
    }

    const scannerPage = await fetch(`${WEB_BASE_URL}/scanner`)
    const scannerPageText = await scannerPage.text()
    if (scannerPage.status !== 200 || !scannerPageText.toLowerCase().includes('<html')) {
      throw new Error('web scanner page failed')
    }

    const myTicketsPage = await fetch(`${WEB_BASE_URL}/my-tickets`)
    const myTicketsPageText = await myTicketsPage.text()
    if (myTicketsPage.status !== 200 || !myTicketsPageText.toLowerCase().includes('<html')) {
      throw new Error('web my tickets page failed')
    }

    const ticketDetailPage = await fetch(`${WEB_BASE_URL}/tickets/${issuedTicketId}`)
    const ticketDetailPageText = await ticketDetailPage.text()
    if (ticketDetailPage.status !== 200 || !ticketDetailPageText.toLowerCase().includes('<html')) {
      throw new Error('web ticket detail page failed')
    }

    console.log('[fullstack] success')
  } finally {
    if (created.saleId) {
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."scans" WHERE ticket_id IN (SELECT id FROM "public"."tickets" WHERE sale_id = $1)',
        created.saleId
      )
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."tickets" WHERE sale_id = $1',
        created.saleId
      )
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."ticket_types" WHERE sale_id = $1',
        created.saleId
      )
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."claims_onchain" WHERE sale_id = $1',
        created.saleId
      )
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."sales" WHERE id = $1',
        created.saleId
      )
    }

    if (created.treasury) {
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."payment_transfers_onchain" WHERE to_address = $1',
        created.treasury
      )
    }

    if (created.eventId) {
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."events" WHERE id = $1',
        created.eventId
      )
    }

    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[fullstack] failed:', error)
  process.exit(1)
})
