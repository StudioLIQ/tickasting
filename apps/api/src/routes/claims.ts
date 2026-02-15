/**
 * Claim Routes — Contract event sync + claim status
 *
 * Handles synchronization between off-chain winner determination
 * and on-chain claim/mint on EVM (Kasplex testnet).
 *
 * Data sources:
 * - Legacy (Prisma): Manual sync via POST /claims/sync
 * - Ponder (target): Auto-indexed from contract events, read via raw SQL
 *
 * Set USE_PONDER_DATA=true to read on-chain claim data from Ponder tables.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import {
  USE_PONDER_DATA,
  ponderTablesExist,
  getPonderClaims,
  formatPonderClaim,
} from '../ponder-client.js'
import { getEvmSaleComputed, useEvmPurchases } from '../evm-purchases.js'

export async function claimRoutes(fastify: FastifyInstance) {
  // Register an on-chain claim (called by backend after detecting TicketClaimed event)
  // NOTE: With Ponder active, this endpoint is optional — Ponder indexes claims automatically.
  const registerClaimSchema = z.object({
    kaspaTxid: z.string().min(1),
    ticketTypeCode: z.string().min(1),
    claimerEvmAddress: z.string().min(1),
    claimTxHash: z.string().min(1),
    tokenId: z.string().min(1),
    finalRank: z.number().int().positive(),
  })

  fastify.post<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/claims/sync',
    async (request, reply) => {
      const { saleId } = request.params

      const parseResult = registerClaimSchema.safeParse(request.body)
      if (!parseResult.success) {
        reply.status(400)
        return { error: 'Validation failed', details: parseResult.error.flatten() }
      }

      const data = parseResult.data

      // Check sale exists
      const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: { ticketTypes: true },
      })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      let buyerAddrHash = ''
      if (useEvmPurchases()) {
        const computed = await getEvmSaleComputed(sale)
        const winner = computed.winners.find((w) => w.txid.toLowerCase() === data.kaspaTxid.toLowerCase())
        if (!winner) {
          reply.status(404)
          return { error: 'Winner not found for payment tx hash' }
        }
        buyerAddrHash = winner.buyerAddrHash
      } else {
        const attempt = await prisma.purchaseAttempt.findFirst({
          where: { saleId, txid: data.kaspaTxid },
        })
        if (!attempt) {
          reply.status(404)
          return { error: 'Purchase attempt not found for kaspaTxid' }
        }
        buyerAddrHash = attempt.buyerAddrHash ?? ''
      }

      // Find ticket type by code
      const ticketType = sale.ticketTypes.find((tt) => tt.code === data.ticketTypeCode)

      // Check if ticket already exists for this txid
      const existingTicket = await prisma.ticket.findFirst({
        where: { saleId, originTxid: data.kaspaTxid },
      })

      if (existingTicket) {
        // Update existing ticket with claim data
        const updated = await prisma.ticket.update({
          where: { id: existingTicket.id },
          data: {
            claimTxid: data.claimTxHash,
            tokenId: data.tokenId,
            ticketTypeId: ticketType?.id ?? null,
          },
        })

        return {
          message: 'Claim synced to existing ticket',
          ticketId: updated.id,
          claimTxid: updated.claimTxid,
          tokenId: updated.tokenId,
        }
      }

      // Create new ticket with claim data
      const ticket = await prisma.ticket.create({
        data: {
          saleId,
          ticketTypeId: ticketType?.id ?? null,
          ownerAddress: data.claimerEvmAddress,
          ownerAddrHash: buyerAddrHash,
          originTxid: data.kaspaTxid,
          claimTxid: data.claimTxHash,
          tokenId: data.tokenId,
          status: 'issued',
        },
      })

      reply.status(201)
      return {
        message: 'Claim registered',
        ticketId: ticket.id,
        claimTxid: ticket.claimTxid,
        tokenId: ticket.tokenId,
      }
    }
  )

  // Get claim status for a sale
  // When USE_PONDER_DATA=true, reads from Ponder's claims_onchain table.
  // Otherwise falls back to legacy Prisma ticket records.
  fastify.get<{ Params: { saleId: string }; Querystring: { source?: string } }>(
    '/v1/sales/:saleId/claims',
    async (request, reply) => {
      const { saleId } = request.params
      const requestedSource = request.query.source // 'ponder' | 'legacy' | undefined

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      // Determine data source
      const usePonder = requestedSource === 'ponder' ||
        (requestedSource !== 'legacy' && USE_PONDER_DATA)

      if (usePonder) {
        const hasTables = await ponderTablesExist()
        if (!hasTables) {
          // Fall back to legacy if Ponder tables don't exist yet
          return getLegacyClaims(saleId)
        }

        const ponderClaims = await getPonderClaims(saleId)
        return {
          saleId,
          source: 'ponder',
          totalClaimed: ponderClaims.length,
          claims: ponderClaims.map(formatPonderClaim),
        }
      }

      return getLegacyClaims(saleId)
    }
  )

  async function getLegacyClaims(saleId: string) {
    const tickets = await prisma.ticket.findMany({
      where: { saleId },
      include: { ticketType: true },
      orderBy: { issuedAt: 'asc' },
    })

    const claimed = tickets.filter((t) => t.claimTxid !== null)
    const unclaimed = tickets.filter((t) => t.claimTxid === null)

    return {
      saleId,
      source: 'legacy',
      totalTickets: tickets.length,
      claimed: claimed.length,
      unclaimed: unclaimed.length,
      tickets: tickets.map((t) => ({
        id: t.id,
        originTxid: t.originTxid,
        ticketTypeCode: t.ticketType?.code ?? null,
        ownerAddress: t.ownerAddress,
        claimTxid: t.claimTxid,
        tokenId: t.tokenId,
        status: t.status,
        issuedAt: t.issuedAt.toISOString(),
      })),
    }
  }

  // Consistency check: compare off-chain winners vs on-chain claims
  // Uses Ponder data when available for on-chain claim source.
  fastify.get<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/claims/consistency',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      const winners = useEvmPurchases()
        ? (await getEvmSaleComputed(sale)).winners.map((w, i) => ({
            txid: w.txid,
            finalRank: i + 1,
            buyerAddrHash: w.buyerAddrHash,
          }))
        : await prisma.purchaseAttempt.findMany({
            where: {
              saleId,
              validationStatus: { in: ['valid', 'valid_fallback'] },
              accepted: true,
              finalRank: { not: null, lte: sale.supplyTotal },
            },
            orderBy: { finalRank: 'asc' },
          })

      // Get on-chain claimed data — prefer Ponder if available
      let claimSource = 'legacy'
      let claimedTxids: Set<string>
      let totalClaimed: number

      const hasPonderTables = await ponderTablesExist()
      if (hasPonderTables) {
        const ponderClaims = await getPonderClaims(saleId)
        claimedTxids = new Set(ponderClaims.map((c) => c.kaspa_txid))
        totalClaimed = ponderClaims.length
        claimSource = 'ponder'
      } else {
        const claimedTickets = await prisma.ticket.findMany({
          where: { saleId, claimTxid: { not: null } },
        })
        claimedTxids = new Set(claimedTickets.map((t) => t.originTxid))
        totalClaimed = claimedTickets.length
      }

      // Find mismatches
      const unclaimedWinners = winners.filter((w) => !claimedTxids.has(w.txid))
      const claimedNonWinnerTxids = [...claimedTxids].filter(
        (txid) => !winners.some((w) => w.txid === txid)
      )

      const consistent = unclaimedWinners.length === 0 && claimedNonWinnerTxids.length === 0

      return {
        saleId,
        claimSource,
        consistent,
        totalWinners: winners.length,
        totalClaimed,
        unclaimedWinners: unclaimedWinners.map((w) => ({
          txid: w.txid,
          finalRank: w.finalRank,
          buyerAddrHash: w.buyerAddrHash,
        })),
        unknownClaims: claimedNonWinnerTxids.map((txid) => ({
          kaspaTxid: txid,
        })),
      }
    }
  )

  // Update contract address for a sale
  const updateContractSchema = z.object({
    claimContractAddress: z.string().min(1),
  })

  fastify.patch<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/contract',
    async (request, reply) => {
      const { saleId } = request.params

      const parseResult = updateContractSchema.safeParse(request.body)
      if (!parseResult.success) {
        reply.status(400)
        return { error: 'Validation failed', details: parseResult.error.flatten() }
      }

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      const updated = await prisma.sale.update({
        where: { id: saleId },
        data: { claimContractAddress: parseResult.data.claimContractAddress },
      })

      return {
        message: 'Contract address updated',
        saleId: updated.id,
        claimContractAddress: updated.claimContractAddress,
      }
    }
  )
}
