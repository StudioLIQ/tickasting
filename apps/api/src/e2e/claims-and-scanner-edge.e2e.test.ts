import { randomBytes, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { encodeTicketQR } from '@tickasting/shared'
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

describe('API E2E - claims and scanner edges', () => {
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

  it('covers claim consistency mismatches and scanner failure branches', async () => {
    if (!prisma) throw new Error('Prisma not initialized')

    const uniqueTag = createUniqueTag()
    const nowSeconds = Math.floor(Date.now() / 1000).toString()

    const eventRes = await requestJson<{ id: string }>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        title: `Claim Scanner ${uniqueTag}`,
        venue: 'Edge Zone',
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

    const txWinner = randomHex(32).toLowerCase()
    const txLoser = randomHex(32).toLowerCase()

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
    await insertPaymentTransferRow(prisma, {
      id: `${txLoser}-1`,
      tokenAddress: randomHex(20).toLowerCase(),
      fromAddress: randomHex(20).toLowerCase(),
      toAddress: treasury,
      value: '1000000',
      txHash: txLoser,
      blockHash: randomHex(32).toLowerCase(),
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      logIndex: '1',
    })

    const allocationRes = await requestJson<{
      winners: Array<{ txid: string }>
      losersCount: number
    }>(`/v1/sales/${saleId}/allocation`)
    expect(allocationRes.status).toBe(200)
    expect(allocationRes.body.winners).toHaveLength(1)
    expect(allocationRes.body.winners[0]?.txid).toBe(txWinner)
    expect(allocationRes.body.losersCount).toBe(1)

    const ownerAddress = randomHex(20).toLowerCase()
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
    const qrCode = issueRes.body.qrCode

    const issueAgainRes = await requestJson<{ message: string }>(
      `/v1/sales/${saleId}/tickets/${txWinner}/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ ownerAddress }),
      }
    )
    expect(issueAgainRes.status).toBe(200)
    expect(issueAgainRes.body.message).toContain('already issued')

    const claimTxHash = randomHex(32).toLowerCase()
    const syncClaimRes = await requestJson<{ message: string; claimTxid: string }>(
      `/v1/sales/${saleId}/claims/sync`,
      {
        method: 'POST',
        body: JSON.stringify({
          kaspaTxid: txWinner,
          ticketTypeCode: 'ONE',
          claimerEvmAddress: ownerAddress,
          claimTxHash,
          tokenId: '1',
          finalRank: 1,
        }),
      }
    )
    expect(syncClaimRes.status).toBe(200)
    expect(syncClaimRes.body.message).toContain('existing ticket')
    expect(syncClaimRes.body.claimTxid).toBe(claimTxHash)

    const legacyClaimsRes = await requestJson<{
      source: string
      claimed: number
      tickets: Array<{ originTxid: string; claimTxid: string | null }>
    }>(`/v1/sales/${saleId}/claims?source=legacy`)
    expect(legacyClaimsRes.status).toBe(200)
    expect(legacyClaimsRes.body.source).toBe('legacy')
    expect(legacyClaimsRes.body.claimed).toBe(1)
    expect(legacyClaimsRes.body.tickets[0]?.originTxid).toBe(txWinner)
    expect(legacyClaimsRes.body.tickets[0]?.claimTxid).toBe(claimTxHash)

    const nonWinnerClaimTx = randomHex(32).toLowerCase()
    await insertPonderClaimRow(prisma, {
      id: `${saleId}-${txLoser}`,
      saleId,
      typeCode: 'ONE',
      claimer: randomHex(20).toLowerCase(),
      tokenId: '2',
      kaspaTxid: txLoser,
      finalRank: '2',
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      transactionHash: nonWinnerClaimTx,
    })

    const consistencyMismatch1 = await requestJson<{
      consistent: boolean
      unknownClaims: Array<{ kaspaTxid: string }>
      unclaimedWinners: Array<{ txid: string }>
    }>(`/v1/sales/${saleId}/claims/consistency`)
    expect(consistencyMismatch1.status).toBe(200)
    expect(consistencyMismatch1.body.consistent).toBe(false)
    expect(consistencyMismatch1.body.unknownClaims.some((c) => c.kaspaTxid === txLoser)).toBe(true)
    expect(consistencyMismatch1.body.unclaimedWinners.some((w) => w.txid === txWinner)).toBe(true)

    await insertPonderClaimRow(prisma, {
      id: `${saleId}-${txWinner}`,
      saleId,
      typeCode: 'ONE',
      claimer: ownerAddress,
      tokenId: '1',
      kaspaTxid: txWinner,
      finalRank: '1',
      blockNumber: '0',
      blockTimestamp: nowSeconds,
      transactionHash: claimTxHash,
    })

    const consistencyMismatch2 = await requestJson<{ consistent: boolean }>(
      `/v1/sales/${saleId}/claims/consistency`
    )
    expect(consistencyMismatch2.status).toBe(200)
    expect(consistencyMismatch2.body.consistent).toBe(false)

    await prisma.$executeRawUnsafe(
      'DELETE FROM "public"."claims_onchain" WHERE sale_id = $1 AND kaspa_txid = $2',
      saleId,
      txLoser
    )

    const consistencyOk = await requestJson<{ consistent: boolean; totalClaimed: number }>(
      `/v1/sales/${saleId}/claims/consistency`
    )
    expect(consistencyOk.status).toBe(200)
    expect(consistencyOk.body.consistent).toBe(true)
    expect(consistencyOk.body.totalClaimed).toBe(1)

    const mismatchQr = encodeTicketQR(
      { ticketId, saleId, txid: txLoser },
      process.env['TICKET_SECRET'] || DEFAULT_TICKET_SECRET
    )
    const mismatchVerify = await requestJson<{ valid: boolean; result: string; message: string }>(
      '/v1/scans/verify',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode: mismatchQr }),
      }
    )
    expect(mismatchVerify.status).toBe(200)
    expect(mismatchVerify.body.valid).toBe(false)
    expect(mismatchVerify.body.result).toBe('deny_invalid_ticket')
    expect(mismatchVerify.body.message).toContain('Ticket data mismatch')

    const fakeQr = encodeTicketQR(
      { ticketId: randomUUID(), saleId, txid: txWinner },
      process.env['TICKET_SECRET'] || DEFAULT_TICKET_SECRET
    )
    const fakeRedeem = await requestJson<{ success: boolean; result: string; message: string }>(
      '/v1/scans/redeem',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode: fakeQr }),
      }
    )
    expect(fakeRedeem.status).toBe(200)
    expect(fakeRedeem.body.success).toBe(false)
    expect(fakeRedeem.body.result).toBe('deny_invalid_ticket')
    expect(fakeRedeem.body.message).toContain('Ticket not found')

    const tamperedQrParts = qrCode.split('|')
    tamperedQrParts[3] = randomHex(32).toLowerCase()
    const tamperedQr = tamperedQrParts.join('|')

    const tamperedVerify = await requestJson<{ valid: boolean; result: string }>(
      '/v1/scans/verify',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode: tamperedQr }),
      }
    )
    expect(tamperedVerify.status).toBe(200)
    expect(tamperedVerify.body.valid).toBe(false)
    expect(tamperedVerify.body.result).toBe('deny_invalid_ticket')

    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'cancelled' },
    })

    const cancelledVerify = await requestJson<{ valid: boolean; result: string; message: string }>(
      '/v1/scans/verify',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode }),
      }
    )
    expect(cancelledVerify.status).toBe(200)
    expect(cancelledVerify.body.valid).toBe(false)
    expect(cancelledVerify.body.result).toBe('deny_invalid_ticket')
    expect(cancelledVerify.body.message).toContain('cancelled')

    const cancelledRedeem = await requestJson<{ success: boolean; result: string }>(
      '/v1/scans/redeem',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode, gateId: 'gate-x' }),
      }
    )
    expect(cancelledRedeem.status).toBe(200)
    expect(cancelledRedeem.body.success).toBe(false)
    expect(cancelledRedeem.body.result).toBe('deny_invalid_ticket')

    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'issued', redeemedAt: null },
    })

    const redeemOk = await requestJson<{ success: boolean; result: string }>(
      '/v1/scans/redeem',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode, gateId: 'gate-x', operatorId: 'op-1' }),
      }
    )
    expect(redeemOk.status).toBe(200)
    expect(redeemOk.body.success).toBe(true)
    expect(redeemOk.body.result).toBe('ok')

    const verifyAfterRedeem = await requestJson<{ valid: boolean; result: string }>(
      '/v1/scans/verify',
      {
        method: 'POST',
        body: JSON.stringify({ qrCode }),
      }
    )
    expect(verifyAfterRedeem.status).toBe(200)
    expect(verifyAfterRedeem.body.valid).toBe(false)
    expect(verifyAfterRedeem.body.result).toBe('deny_already_redeemed')

    const ticketRes = await requestJson<{
      status: string
      recentScans: Array<{ result: string }>
    }>(`/v1/tickets/${ticketId}`)
    expect(ticketRes.status).toBe(200)
    expect(ticketRes.body.status).toBe('redeemed')
    expect(ticketRes.body.recentScans.length).toBeGreaterThanOrEqual(2)
    expect(ticketRes.body.recentScans.some((s) => s.result === 'ok')).toBe(true)
    expect(ticketRes.body.recentScans.some((s) => s.result === 'deny_invalid_ticket')).toBe(true)

    const missingTicketRes = await requestJson<{ error: string }>(
      `/v1/tickets/${randomUUID()}`
    )
    expect(missingTicketRes.status).toBe(404)
    expect(missingTicketRes.body.error).toContain('Ticket not found')
  }, 30000)
})
