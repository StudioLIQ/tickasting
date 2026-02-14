/**
 * Claim Routes — Contract event sync + claim status
 *
 * Handles synchronization between off-chain winner determination
 * and on-chain claim/mint on EVM (Sepolia).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'

export async function claimRoutes(fastify: FastifyInstance) {
  // Register an on-chain claim (called by backend after detecting TicketClaimed event)
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

      // Find the purchase attempt by Kaspa txid
      const attempt = await prisma.purchaseAttempt.findFirst({
        where: { saleId, txid: data.kaspaTxid },
      })
      if (!attempt) {
        reply.status(404)
        return { error: 'Purchase attempt not found for kaspaTxid' }
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
          ownerAddrHash: attempt.buyerAddrHash ?? '',
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
  fastify.get<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/claims',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      const tickets = await prisma.ticket.findMany({
        where: { saleId },
        include: { ticketType: true },
        orderBy: { issuedAt: 'asc' },
      })

      const claimed = tickets.filter((t) => t.claimTxid !== null)
      const unclaimed = tickets.filter((t) => t.claimTxid === null)

      return {
        saleId,
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
  )

  // Consistency check: compare off-chain winners vs on-chain claims
  fastify.get<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/claims/consistency',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      // Get off-chain winners (final rank <= supply)
      const winners = await prisma.purchaseAttempt.findMany({
        where: {
          saleId,
          validationStatus: { in: ['valid', 'valid_fallback'] },
          accepted: true,
          finalRank: { not: null, lte: sale.supplyTotal },
        },
        orderBy: { finalRank: 'asc' },
      })

      // Get on-chain claimed tickets
      const claimedTickets = await prisma.ticket.findMany({
        where: { saleId, claimTxid: { not: null } },
      })
      const claimedTxids = new Set(claimedTickets.map((t) => t.originTxid))

      // Find mismatches
      const unclaimedWinners = winners.filter((w) => !claimedTxids.has(w.txid))
      const unknownClaims = claimedTickets.filter(
        (t) => !winners.some((w) => w.txid === t.originTxid)
      )

      const consistent = unclaimedWinners.length === 0 && unknownClaims.length === 0

      return {
        saleId,
        consistent,
        totalWinners: winners.length,
        totalClaimed: claimedTickets.length,
        unclaimedWinners: unclaimedWinners.map((w) => ({
          txid: w.txid,
          finalRank: w.finalRank,
          buyerAddrHash: w.buyerAddrHash,
        })),
        unknownClaims: unknownClaims.map((t) => ({
          ticketId: t.id,
          originTxid: t.originTxid,
          claimTxid: t.claimTxid,
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
