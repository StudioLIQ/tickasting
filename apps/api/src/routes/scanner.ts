/**
 * Scanner API Routes
 *
 * Handles ticket verification and redemption at the gate
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getEvmSaleComputed, useEvmPurchases } from '../evm-purchases.js'
import {
  computeBuyerAddrHash,
  decodeTicketQR,
  encodeTicketQR,
  type TicketQRData,
} from '@tickasting/shared'

// Get secret from env (should be set in production)
const TICKET_SECRET = process.env['TICKET_SECRET'] || 'dev-ticket-secret-change-in-prod'

export async function scannerRoutes(fastify: FastifyInstance) {
  // Issue ticket for a winner
  const issueTicketSchema = z.object({
    ownerAddress: z.string().min(1, 'ownerAddress is required'),
  })

  fastify.post<{ Params: { saleId: string; txid: string } }>(
    '/v1/sales/:saleId/tickets/:txid/issue',
    async (request, reply) => {
      const { saleId, txid } = request.params

      const parseResult = issueTicketSchema.safeParse(request.body)
      if (!parseResult.success) {
        reply.status(400)
        return { error: 'Validation failed', details: parseResult.error.flatten() }
      }

      const { ownerAddress } = parseResult.data

      // Check sale exists
      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      let buyerAddrHash = ''
      if (useEvmPurchases()) {
        const computed = await getEvmSaleComputed(sale)
        const attempt = computed.winners.find((a) => a.txid.toLowerCase() === txid.toLowerCase())

        if (!attempt) {
          reply.status(400)
          return { error: 'Not a winner or not finalized yet' }
        }
        buyerAddrHash = attempt.buyerAddrHash
      } else {
        const attempt = await prisma.purchaseAttempt.findFirst({
          where: { saleId, txid },
        })

        if (!attempt) {
          reply.status(404)
          return { error: 'Purchase attempt not found' }
        }

        if (attempt.validationStatus !== 'valid') {
          reply.status(400)
          return { error: 'Purchase is not valid', status: attempt.validationStatus }
        }

        if (!attempt.finalRank || attempt.finalRank > sale.supplyTotal) {
          reply.status(400)
          return { error: 'Not a winner', finalRank: attempt.finalRank }
        }
        buyerAddrHash = attempt.buyerAddrHash ?? ''
      }

      // Check if ticket already issued for this txid
      const existingTicket = await prisma.ticket.findFirst({
        where: { saleId, originTxid: txid },
      })

      if (existingTicket) {
        // Return existing ticket
        const qrData: TicketQRData = {
          ticketId: existingTicket.id,
          saleId: existingTicket.saleId,
          txid: existingTicket.originTxid,
        }
        const qrCode = encodeTicketQR(qrData, TICKET_SECRET)

        return {
          message: 'Ticket already issued',
          ticket: {
            id: existingTicket.id,
            status: existingTicket.status,
            issuedAt: existingTicket.issuedAt.toISOString(),
          },
          qrCode,
        }
      }

      // Create ticket
      const ticket = await prisma.ticket.create({
        data: {
          saleId,
          ownerAddress,
          ownerAddrHash: buyerAddrHash || computeBuyerAddrHash(ownerAddress.toLowerCase()),
          originTxid: txid,
          status: 'issued',
          qrSignature: '', // Will be updated below
        },
      })

      // Generate QR code
      const qrData: TicketQRData = {
        ticketId: ticket.id,
        saleId,
        txid,
      }
      const qrCode = encodeTicketQR(qrData, TICKET_SECRET)

      // Update with signature
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { qrSignature: qrCode.split('|').pop() || '' },
      })

      reply.status(201)
      return {
        message: 'Ticket issued successfully',
        ticket: {
          id: ticket.id,
          saleId,
          originTxid: txid,
          status: ticket.status,
          issuedAt: ticket.issuedAt.toISOString(),
        },
        qrCode,
      }
    }
  )

  // Verify ticket (read-only check)
  const verifySchema = z.object({
    qrCode: z.string().min(1, 'qrCode is required'),
  })

  fastify.post('/v1/scans/verify', async (request, reply) => {
    const parseResult = verifySchema.safeParse(request.body)
    if (!parseResult.success) {
      reply.status(400)
      return { error: 'Validation failed', details: parseResult.error.flatten() }
    }

    const { qrCode } = parseResult.data

    // Decode and verify signature
    const decoded = decodeTicketQR(qrCode, TICKET_SECRET)
    if (!decoded.valid || !decoded.data) {
      return {
        valid: false,
        result: 'deny_invalid_ticket',
        message: decoded.error || 'Invalid ticket',
      }
    }

    const { ticketId, saleId, txid } = decoded.data

    // Get ticket from DB
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        sale: {
          include: { event: true },
        },
      },
    })

    if (!ticket) {
      return {
        valid: false,
        result: 'deny_invalid_ticket',
        message: 'Ticket not found in database',
      }
    }

    // Verify sale and txid match
    if (ticket.saleId !== saleId || ticket.originTxid !== txid) {
      return {
        valid: false,
        result: 'deny_invalid_ticket',
        message: 'Ticket data mismatch',
      }
    }

    // Check ticket status
    if (ticket.status === 'redeemed') {
      return {
        valid: false,
        result: 'deny_already_redeemed',
        message: 'Ticket has already been used',
        redeemedAt: ticket.redeemedAt?.toISOString(),
      }
    }

    if (ticket.status === 'cancelled') {
      return {
        valid: false,
        result: 'deny_invalid_ticket',
        message: 'Ticket has been cancelled',
      }
    }

    // Ticket is valid
    return {
      valid: true,
      result: 'ok',
      ticket: {
        id: ticket.id,
        status: ticket.status,
        eventTitle: ticket.sale.event.title,
        saleId: ticket.saleId,
        issuedAt: ticket.issuedAt.toISOString(),
      },
    }
  })

  // Redeem ticket (one-time use)
  const redeemSchema = z.object({
    qrCode: z.string().min(1, 'qrCode is required'),
    gateId: z.string().optional(),
    operatorId: z.string().optional(),
  })

  fastify.post('/v1/scans/redeem', async (request, reply) => {
    const parseResult = redeemSchema.safeParse(request.body)
    if (!parseResult.success) {
      reply.status(400)
      return { error: 'Validation failed', details: parseResult.error.flatten() }
    }

    const { qrCode, gateId, operatorId } = parseResult.data

    // Decode and verify signature
    const decoded = decodeTicketQR(qrCode, TICKET_SECRET)
    if (!decoded.valid || !decoded.data) {
      // Log failed scan attempt
      await prisma.scan.create({
        data: {
          ticketId: '00000000-0000-0000-0000-000000000000', // Placeholder for invalid
          gateId,
          operatorId,
          result: 'deny_invalid_ticket',
        },
      }).catch(() => {})

      return {
        success: false,
        result: 'deny_invalid_ticket',
        message: decoded.error || 'Invalid ticket',
      }
    }

    const { ticketId, saleId, txid } = decoded.data

    // Get ticket from DB
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        sale: {
          include: { event: true },
        },
      },
    })

    if (!ticket) {
      return {
        success: false,
        result: 'deny_invalid_ticket',
        message: 'Ticket not found',
      }
    }

    // Verify sale and txid match
    if (ticket.saleId !== saleId || ticket.originTxid !== txid) {
      await prisma.scan.create({
        data: { ticketId, gateId, operatorId, result: 'deny_invalid_ticket' },
      })
      return {
        success: false,
        result: 'deny_invalid_ticket',
        message: 'Ticket data mismatch',
      }
    }

    // Check if already redeemed
    if (ticket.status === 'redeemed') {
      await prisma.scan.create({
        data: { ticketId, gateId, operatorId, result: 'deny_already_redeemed' },
      })
      return {
        success: false,
        result: 'deny_already_redeemed',
        message: 'Ticket has already been used',
        redeemedAt: ticket.redeemedAt?.toISOString(),
      }
    }

    if (ticket.status === 'cancelled') {
      await prisma.scan.create({
        data: { ticketId, gateId, operatorId, result: 'deny_invalid_ticket' },
      })
      return {
        success: false,
        result: 'deny_invalid_ticket',
        message: 'Ticket has been cancelled',
      }
    }

    // Redeem ticket
    const now = new Date()
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: 'redeemed',
        redeemedAt: now,
      },
    })

    // Log successful scan
    await prisma.scan.create({
      data: { ticketId, gateId, operatorId, result: 'ok' },
    })

    return {
      success: true,
      result: 'ok',
      message: 'Ticket redeemed successfully',
      ticket: {
        id: ticket.id,
        eventTitle: ticket.sale.event.title,
        redeemedAt: now.toISOString(),
      },
    }
  })

  // Get ticket by ID
  fastify.get<{ Params: { ticketId: string } }>(
    '/v1/tickets/:ticketId',
    async (request, reply) => {
      const { ticketId } = request.params

      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          sale: {
            include: { event: true },
          },
          scans: {
            orderBy: { scannedAt: 'desc' },
            take: 5,
          },
        },
      })

      if (!ticket) {
        reply.status(404)
        return { error: 'Ticket not found' }
      }

      // Generate QR code
      const qrData: TicketQRData = {
        ticketId: ticket.id,
        saleId: ticket.saleId,
        txid: ticket.originTxid,
      }
      const qrCode = encodeTicketQR(qrData, TICKET_SECRET)

      return {
        id: ticket.id,
        saleId: ticket.saleId,
        eventTitle: ticket.sale.event.title,
        originTxid: ticket.originTxid,
        status: ticket.status,
        issuedAt: ticket.issuedAt.toISOString(),
        redeemedAt: ticket.redeemedAt?.toISOString() ?? null,
        qrCode,
        recentScans: ticket.scans.map((s) => ({
          scannedAt: s.scannedAt.toISOString(),
          result: s.result,
          gateId: s.gateId,
        })),
      }
    }
  )
}
