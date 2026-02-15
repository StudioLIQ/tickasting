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

let eventId: string | null = null
let saleId: string | null = null
let treasuryAddress: string | null = null

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

async function insertPonderClaimRow(
  client: PrismaClient,
  data: {
    id: string
    saleId: string
    typeCode: string
    claimer: string
    tokenId: string
    kaspaTxid: string
    finalRank: string
    blockNumber: string
    blockTimestamp: string
    transactionHash: string
  }
) {
  await client.$executeRawUnsafe(
    `INSERT INTO "public"."claims_onchain"
      (id, sale_id, type_code, claimer, token_id, kaspa_txid, final_rank, block_number, block_timestamp, transaction_hash)
    VALUES
      ($1, $2, $3, $4, $5::numeric, $6, $7::numeric, $8::numeric, $9::numeric, $10)
    ON CONFLICT (id) DO NOTHING`,
    data.id,
    data.saleId,
    data.typeCode,
    data.claimer,
    data.tokenId,
    data.kaspaTxid,
    data.finalRank,
    data.blockNumber,
    data.blockTimestamp,
    data.transactionHash
  )
}

describe('API E2E - full ticket lifecycle', () => {
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
    if (prisma && saleId) {
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

    if (prisma && treasuryAddress) {
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."payment_transfers_onchain" WHERE to_address = $1',
        treasuryAddress
      )
    }

    if (prisma && eventId) {
      await prisma.$executeRawUnsafe(
        'DELETE FROM "public"."events" WHERE id = $1',
        eventId
      )
    }

    if (server) {
      await server.close()
    }

    if (prisma) {
      await prisma.$disconnect()
    }
  })

  it('verifies organizer, buyer, claim, and scanner flows', async () => {
    if (!prisma) throw new Error('Prisma client is not initialized')

    const uniqueTag = createUniqueTag()
    const tokenAddress = randomHex(20).toLowerCase()
    const nowSeconds = Math.floor(Date.now() / 1000).toString()

    const health = await requestJson<{
      status: string
      usePonderData: boolean
      purchaseMode: string
    }>('/health')
    expect(health.status).toBe(200)
    expect(health.body.status).toBe('ok')
    expect(health.body.usePonderData).toBe(true)
    expect(health.body.purchaseMode).toBe('evm')

    const createdEvent = await requestJson<{ id: string }>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        title: `E2E Event ${uniqueTag}`,
        venue: 'Local Test Arena',
      }),
    })
    expect(createdEvent.status).toBe(201)
    expect(createdEvent.body.id).toBeTypeOf('string')
    eventId = createdEvent.body.id

    treasuryAddress = randomHex(20).toLowerCase()

    const createdSale = await requestJson<{
      id: string
      status: string
      finalityDepth: number
      ticketTypes: Array<{ code: string }>
    }>(`/v1/events/${eventId}/sales`, {
      method: 'POST',
      body: JSON.stringify({
        network: 'kasplex-testnet',
        treasuryAddress,
        ticketPriceSompi: '1000000',
        supplyTotal: 2,
        finalityDepth: 1,
        ticketTypes: [
          { code: 'VIP', name: 'VIP', priceSompi: '1000000', supply: 1 },
          { code: 'GEN', name: 'General', priceSompi: '2000000', supply: 2 },
        ],
      }),
    })
    expect(createdSale.status).toBe(201)
    expect(createdSale.body.status).toBe('scheduled')
    expect(createdSale.body.finalityDepth).toBe(1)
    expect(createdSale.body.ticketTypes.map((t) => t.code)).toEqual(['VIP', 'GEN'])
    saleId = createdSale.body.id

    const addType = await requestJson<{ id: string; code: string }>(
      `/v1/sales/${saleId}/ticket-types`,
      {
        method: 'POST',
        body: JSON.stringify({
          code: 'PREM',
          name: 'Premium',
          priceSompi: '3000000',
          supply: 1,
          sortOrder: 2,
        }),
      }
    )
    expect(addType.status).toBe(201)
    expect(addType.body.code).toBe('PREM')

    const updateType = await requestJson<{ name: string; sortOrder: number }>(
      `/v1/sales/${saleId}/ticket-types/${addType.body.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Premium Plus',
          sortOrder: 3,
        }),
      }
    )
    expect(updateType.status).toBe(200)
    expect(updateType.body.name).toBe('Premium Plus')
    expect(updateType.body.sortOrder).toBe(3)

    const txWinner1 = randomHex(32).toLowerCase()
    const txWinner2 = randomHex(32).toLowerCase()
    const txLoser = randomHex(32).toLowerCase()
    const txInvalid = randomHex(32).toLowerCase()

    await insertPaymentTransferRow(prisma, {
      id: `${txWinner1}-0`,
      tokenAddress,
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasuryAddress,
      value: '1000000',
      txHash: txWinner1,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '0',
    })
    await insertPaymentTransferRow(prisma, {
      id: `${txWinner2}-1`,
      tokenAddress,
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasuryAddress,
      value: '2000000',
      txHash: txWinner2,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '1',
    })
    await insertPaymentTransferRow(prisma, {
      id: `${txInvalid}-2`,
      tokenAddress,
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasuryAddress,
      value: '999999',
      txHash: txInvalid,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '2',
    })
    await insertPaymentTransferRow(prisma, {
      id: `${txLoser}-3`,
      tokenAddress,
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasuryAddress,
      value: '1000000',
      txHash: txLoser,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '3',
    })

    const publishedSale = await requestJson<{ sale: { status: string } }>(
      `/v1/sales/${saleId}/publish`,
      {
        method: 'POST',
      }
    )
    expect(publishedSale.status).toBe(200)
    expect(publishedSale.body.sale.status).toBe('live')

    const shouldFailPatch = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/ticket-types/${addType.body.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Nope' }),
      }
    )
    expect(shouldFailPatch.status).toBe(400)
    expect(shouldFailPatch.body.error).toContain('Cannot modify ticket types')

    const stats = await requestJson<{
      totalAttempts: number
      validAttempts: number
      acceptedAttempts: number
      finalAttempts: number
      remaining: number
      saleId: string
    }>(`/v1/sales/${saleId}/stats`)
    expect(stats.status).toBe(200)
    expect(stats.body.saleId).toBe(saleId)
    expect(stats.body.totalAttempts).toBe(4)
    expect(stats.body.validAttempts).toBe(3)
    expect(stats.body.acceptedAttempts).toBe(3)
    expect(stats.body.finalAttempts).toBe(3)
    expect(stats.body.remaining).toBe(0)

    const ws = await connectWebSocket(`${wsBaseUrl}/ws/sales/${saleId}`)

    const firstStats = await waitForWsMessage(ws, (msg) => msg['type'] === 'stats')
    expect((firstStats['data'] as JsonRecord)['saleId']).toBe(saleId)

    const pongPromise = waitForWsMessage(ws, (msg) => msg['type'] === 'pong')
    ws.send(JSON.stringify({ type: 'ping' }))
    const pong = await pongPromise
    expect(pong['type']).toBe('pong')

    const myStatusViaWsPromise = waitForWsMessage(
      ws,
      (msg) => msg['type'] === 'my_status'
    )
    ws.send(JSON.stringify({ type: 'get_my_status', txid: txWinner1 }))
    const myStatusViaWs = await myStatusViaWsPromise
    const wsStatusData = myStatusViaWs['data'] as JsonRecord
    expect(wsStatusData['found']).toBe(true)
    expect(wsStatusData['txid']).toBe(txWinner1)
    expect(wsStatusData['finalRank']).toBe(1)

    ws.close()

    const winnerStatus = await requestJson<{ found: boolean; isWinner: boolean; finalRank: number }>(
      `/v1/sales/${saleId}/my-status?txid=${txWinner2}`
    )
    expect(winnerStatus.status).toBe(200)
    expect(winnerStatus.body.found).toBe(true)
    expect(winnerStatus.body.isWinner).toBe(true)
    expect(winnerStatus.body.finalRank).toBe(2)

    const unknownStatus = await requestJson<{ found: boolean; message: string }>(
      `/v1/sales/${saleId}/my-status?txid=${randomHex(32).toLowerCase()}`
    )
    expect(unknownStatus.status).toBe(200)
    expect(unknownStatus.body.found).toBe(false)
    expect(unknownStatus.body.message).toContain('Transaction not found')

    const allocation = await requestJson<{
      winners: Array<{ txid: string; finalRank: number }>
      losersCount: number
      merkleRoot: string | null
    }>(`/v1/sales/${saleId}/allocation`)
    expect(allocation.status).toBe(200)
    expect(allocation.body.winners).toHaveLength(2)
    expect(allocation.body.winners[0]?.txid).toBe(txWinner1)
    expect(allocation.body.winners[0]?.finalRank).toBe(1)
    expect(allocation.body.winners[1]?.txid).toBe(txWinner2)
    expect(allocation.body.losersCount).toBe(1)
    expect(allocation.body.merkleRoot).toBeTypeOf('string')

    const finalizing = await requestJson<{ sale: { status: string } }>(
      `/v1/sales/${saleId}/finalize`,
      { method: 'POST' }
    )
    expect(finalizing.status).toBe(200)
    expect(finalizing.body.sale.status).toBe('finalizing')

    const commitTxid = randomHex(32).toLowerCase()
    const committed = await requestJson<{ merkleRoot: string | null; commitTxid: string }>(
      `/v1/sales/${saleId}/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ commitTxid }),
      }
    )
    expect(committed.status).toBe(200)
    expect(committed.body.commitTxid).toBe(commitTxid)
    expect(committed.body.merkleRoot).toBeTypeOf('string')

    const proofWinner = await requestJson<{
      found: boolean
      txid: string
      finalRank: number
      merkleRoot: string
      proof: unknown[]
    }>(`/v1/sales/${saleId}/merkle-proof?txid=${txWinner1}`)
    expect(proofWinner.status).toBe(200)
    expect(proofWinner.body.found).toBe(true)
    expect(proofWinner.body.txid).toBe(txWinner1)
    expect(proofWinner.body.finalRank).toBe(1)
    expect(Array.isArray(proofWinner.body.proof)).toBe(true)
    expect(proofWinner.body.merkleRoot).toBeTypeOf('string')

    const proofLoser = await requestJson<{ found: boolean }>(
      `/v1/sales/${saleId}/merkle-proof?txid=${txLoser}`
    )
    expect(proofLoser.status).toBe(200)
    expect(proofLoser.body.found).toBe(false)

    const contractAddress = randomHex(20).toLowerCase()
    const updatedContract = await requestJson<{ claimContractAddress: string }>(
      `/v1/sales/${saleId}/contract`,
      {
        method: 'PATCH',
        body: JSON.stringify({ claimContractAddress: contractAddress }),
      }
    )
    expect(updatedContract.status).toBe(200)
    expect(updatedContract.body.claimContractAddress).toBe(contractAddress)

    const claimTxHash1 = randomHex(32).toLowerCase()
    const claimer1 = randomHex(20).toLowerCase()
    const claimSynced = await requestJson<{ ticketId: string; claimTxid: string }>(
      `/v1/sales/${saleId}/claims/sync`,
      {
        method: 'POST',
        body: JSON.stringify({
          kaspaTxid: txWinner1,
          ticketTypeCode: 'VIP',
          claimerEvmAddress: claimer1,
          claimTxHash: claimTxHash1,
          tokenId: '1',
          finalRank: 1,
        }),
      }
    )
    expect(claimSynced.status).toBe(201)
    expect(claimSynced.body.claimTxid).toBe(claimTxHash1)

    const legacyClaims = await requestJson<{
      source: string
      claimed: number
      unclaimed: number
      tickets: Array<{ originTxid: string; claimTxid: string | null }>
    }>(`/v1/sales/${saleId}/claims?source=legacy`)
    expect(legacyClaims.status).toBe(200)
    expect(legacyClaims.body.source).toBe('legacy')
    expect(legacyClaims.body.claimed).toBe(1)
    expect(legacyClaims.body.unclaimed).toBe(0)
    expect(legacyClaims.body.tickets[0]?.originTxid).toBe(txWinner1)

    await insertPonderClaimRow(prisma, {
      id: `${saleId}-${txWinner1}`,
      saleId,
      typeCode: 'VIP',
      claimer: claimer1,
      tokenId: '1',
      kaspaTxid: txWinner1,
      finalRank: '1',
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      transactionHash: claimTxHash1,
    })

    const ponderClaims = await requestJson<{
      source: string
      totalClaimed: number
      claims: Array<{ kaspaTxid: string }>
    }>(`/v1/sales/${saleId}/claims`)
    expect(ponderClaims.status).toBe(200)
    expect(ponderClaims.body.source).toBe('ponder')
    expect(ponderClaims.body.totalClaimed).toBe(1)
    expect(ponderClaims.body.claims[0]?.kaspaTxid).toBe(txWinner1)

    const consistencyNotYet = await requestJson<{
      consistent: boolean
      totalWinners: number
      totalClaimed: number
      unclaimedWinners: Array<{ txid: string }>
    }>(`/v1/sales/${saleId}/claims/consistency`)
    expect(consistencyNotYet.status).toBe(200)
    expect(consistencyNotYet.body.consistent).toBe(false)
    expect(consistencyNotYet.body.totalWinners).toBe(2)
    expect(consistencyNotYet.body.totalClaimed).toBe(1)
    expect(consistencyNotYet.body.unclaimedWinners[0]?.txid).toBe(txWinner2)

    const claimTxHash2 = randomHex(32).toLowerCase()
    const claimer2 = randomHex(20).toLowerCase()
    await insertPonderClaimRow(prisma, {
      id: `${saleId}-${txWinner2}`,
      saleId,
      typeCode: 'GEN',
      claimer: claimer2,
      tokenId: '2',
      kaspaTxid: txWinner2,
      finalRank: '2',
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      transactionHash: claimTxHash2,
    })

    const consistencyOk = await requestJson<{ consistent: boolean; totalClaimed: number }>(
      `/v1/sales/${saleId}/claims/consistency`
    )
    expect(consistencyOk.status).toBe(200)
    expect(consistencyOk.body.consistent).toBe(true)
    expect(consistencyOk.body.totalClaimed).toBe(2)

    const issued = await requestJson<{
      ticket: { id: string; status: string }
      qrCode: string
    }>(`/v1/sales/${saleId}/tickets/${txWinner2}/issue`, {
      method: 'POST',
      body: JSON.stringify({ ownerAddress: claimer2 }),
    })
    expect(issued.status).toBe(201)
    expect(issued.body.ticket.status).toBe('issued')
    expect(issued.body.qrCode).toContain('TK1|')

    const reissued = await requestJson<{ message: string }>(
      `/v1/sales/${saleId}/tickets/${txWinner2}/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ ownerAddress: claimer2 }),
      }
    )
    expect(reissued.status).toBe(200)
    expect(reissued.body.message).toContain('already issued')

    const loserIssue = await requestJson<{ error: string }>(
      `/v1/sales/${saleId}/tickets/${txLoser}/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ ownerAddress: randomHex(20).toLowerCase() }),
      }
    )
    expect(loserIssue.status).toBe(400)
    expect(loserIssue.body.error).toContain('Not a winner')

    const verify = await requestJson<{ valid: boolean; result: string }>(
      '/v1/scans/verify',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode: issued.body.qrCode }),
      }
    )
    expect(verify.status).toBe(200)
    expect(verify.body.valid).toBe(true)
    expect(verify.body.result).toBe('ok')

    const firstRedeem = await requestJson<{ success: boolean; result: string }>(
      '/v1/scans/redeem',
      {
        method: 'POST',
        body: JSON.stringify({
          qrCode: issued.body.qrCode,
          gateId: 'gate-a',
          operatorId: 'operator-e2e',
        }),
      }
    )
    expect(firstRedeem.status).toBe(200)
    expect(firstRedeem.body.success).toBe(true)
    expect(firstRedeem.body.result).toBe('ok')

    const secondRedeem = await requestJson<{ success: boolean; result: string }>(
      '/v1/scans/redeem',
      {
        method: 'POST',
        body: JSON.stringify({
          qrCode: issued.body.qrCode,
          gateId: 'gate-a',
          operatorId: 'operator-e2e',
        }),
      }
    )
    expect(secondRedeem.status).toBe(200)
    expect(secondRedeem.body.success).toBe(false)
    expect(secondRedeem.body.result).toBe('deny_already_redeemed')

    const ticket = await requestJson<{
      status: string
      recentScans: Array<{ result: string }>
    }>(`/v1/tickets/${issued.body.ticket.id}`)
    expect(ticket.status).toBe(200)
    expect(ticket.body.status).toBe('redeemed')
    expect(ticket.body.recentScans.length).toBeGreaterThanOrEqual(2)

    const ticketTypes = await requestJson<{
      ticketTypes: Array<{ code: string; minted: number }>
    }>(`/v1/sales/${saleId}/ticket-types`)
    expect(ticketTypes.status).toBe(200)
    const vip = ticketTypes.body.ticketTypes.find((tt) => tt.code === 'VIP')
    expect(vip?.minted).toBe(1)

    const salesByEvent = await requestJson<{ sales: Array<{ id: string }> }>(
      `/v1/sales?eventId=${eventId}`
    )
    expect(salesByEvent.status).toBe(200)
    expect(salesByEvent.body.sales.some((s) => s.id === saleId)).toBe(true)

    const fetchedEvent = await requestJson<{ sales: Array<{ id: string }> }>(
      `/v1/events/${eventId}`
    )
    expect(fetchedEvent.status).toBe(200)
    expect(fetchedEvent.body.sales.some((s) => s.id === saleId)).toBe(true)
  }, 60000)
})
