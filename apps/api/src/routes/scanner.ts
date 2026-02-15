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
    ticketTypeCode: z.string().min(1).optional(),
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

      const { ownerAddress, ticketTypeCode } = parseResult.data

      // Check sale exists
      const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: { ticketTypes: true },
      })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      let resolvedTicketTypeId: string | null = null
      if (ticketTypeCode) {
        const matched = sale.ticketTypes.find((tt) => tt.code === ticketTypeCode)
        if (!matched) {
          reply.status(400)
          return { error: `Unknown ticket type code '${ticketTypeCode}'` }
        }
        resolvedTicketTypeId = matched.id
      } else if (sale.ticketTypes.length === 1) {
        const onlyType = sale.ticketTypes[0]
        if (onlyType) {
          resolvedTicketTypeId = onlyType.id
        }
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
          ticketTypeId: resolvedTicketTypeId,
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
      // Invalid QR has no ticketId; skip DB write because scans.ticket_id is required.

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

  // List tickets by owner address (for buyer portal)
  const listTicketsSchema = z.object({
    ownerAddress: z.string().min(1, 'ownerAddress is required'),
    saleId: z.string().optional(),
    status: z.enum(['issued', 'redeemed', 'cancelled']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  })

  fastify.get('/v1/tickets', async (request, reply) => {
    const parseResult = listTicketsSchema.safeParse(request.query)
    if (!parseResult.success) {
      reply.status(400)
      return { error: 'Validation failed', details: parseResult.error.flatten() }
    }

    const { ownerAddress, saleId, status, limit } = parseResult.data

    const tickets = await prisma.ticket.findMany({
      where: {
        ownerAddress: { equals: ownerAddress, mode: 'insensitive' },
        ...(saleId ? { saleId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        sale: {
          include: { event: true },
        },
        ticketType: true,
      },
      orderBy: { issuedAt: 'desc' },
      take: limit,
    })

    return {
      ownerAddress: ownerAddress.toLowerCase(),
      total: tickets.length,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        saleId: ticket.saleId,
        saleStatus: ticket.sale.status,
        eventTitle: ticket.sale.event.title,
        ticketTypeCode: ticket.ticketType?.code ?? null,
        ticketTypeName: ticket.ticketType?.name ?? null,
        ownerAddress: ticket.ownerAddress,
        originTxid: ticket.originTxid,
        claimTxid: ticket.claimTxid,
        tokenId: ticket.tokenId,
        status: ticket.status,
        issuedAt: ticket.issuedAt.toISOString(),
        redeemedAt: ticket.redeemedAt?.toISOString() ?? null,
        metadata: buildTicketMetadataSummary(ticket),
      })),
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
          ticketType: true,
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
        ticketTypeCode: ticket.ticketType?.code ?? null,
        ticketTypeName: ticket.ticketType?.name ?? null,
        ownerAddress: ticket.ownerAddress,
        ownerAddrHash: ticket.ownerAddrHash,
        tokenId: ticket.tokenId,
        claimTxid: ticket.claimTxid,
        originTxid: ticket.originTxid,
        status: ticket.status,
        issuedAt: ticket.issuedAt.toISOString(),
        redeemedAt: ticket.redeemedAt?.toISOString() ?? null,
        qrCode,
        metadata: buildTicketNftMetadata(ticket),
        recentScans: ticket.scans.map((s) => ({
          scannedAt: s.scannedAt.toISOString(),
          result: s.result,
          gateId: s.gateId,
        })),
      }
    }
  )

  // Get ticket metadata (NFT style)
  fastify.get<{ Params: { ticketId: string } }>(
    '/v1/tickets/:ticketId/metadata',
    async (request, reply) => {
      const { ticketId } = request.params

      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          sale: {
            include: { event: true },
          },
          ticketType: true,
        },
      })

      if (!ticket) {
        reply.status(404)
        return { error: 'Ticket not found' }
      }

      return buildTicketNftMetadata(ticket)
    }
  )
}

interface TicketNftAttribute {
  trait_type: string
  value: string | number | boolean
}

interface TicketMetadataSummary {
  performanceTitle: string
  performanceDate: string | null
  performanceEndDate: string | null
  venue: string | null
  seat: string
}

interface TicketNftMetadata {
  name: string
  description: string
  image: string | null
  external_url: string | null
  attributes: TicketNftAttribute[]
  properties: {
    ticketId: string
    saleId: string
    ownerAddress: string
    ownerAddrHash: string
    originTxid: string
    claimTxid: string | null
    tokenId: string | null
    ticketTypeCode: string | null
    ticketTypeName: string | null
    performanceTitle: string
    performanceDate: string | null
    performanceEndDate: string | null
    venue: string | null
    seat: string
    status: string
  }
}

interface TicketWithMetadataContext {
  id: string
  saleId: string
  ownerAddress: string
  ownerAddrHash: string
  originTxid: string
  claimTxid: string | null
  tokenId: string | null
  status: string
  issuedAt: Date
  redeemedAt: Date | null
  sale: {
    status: string
    event: {
      title: string
      venue: string | null
      startAt: Date | null
      endAt: Date | null
    }
  }
  ticketType: {
    code: string
    name: string
    metadataUri: string | null
    perk: unknown
  } | null
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

function readPerkField(perk: unknown, keys: string[]): string | null {
  const obj = asObject(perk)
  if (!obj) return null
  for (const key of keys) {
    const value = asText(obj[key])
    if (value) return value
  }
  return null
}

function buildSeatLabel(ticketType: TicketWithMetadataContext['ticketType']): string {
  if (!ticketType) return 'General Admission'

  const explicitSeat = readPerkField(ticketType.perk, ['seat', 'seatLabel'])
  if (explicitSeat) return explicitSeat

  const section = readPerkField(ticketType.perk, ['section'])
  const row = readPerkField(ticketType.perk, ['row'])
  const number = readPerkField(ticketType.perk, ['seatNumber', 'number'])
  const parts = [section && `Section ${section}`, row && `Row ${row}`, number && `Seat ${number}`].filter(
    Boolean
  ) as string[]

  return parts.length > 0 ? parts.join(' / ') : 'General Admission'
}

function buildTicketMetadataSummary(ticket: TicketWithMetadataContext): TicketMetadataSummary {
  return {
    performanceTitle: ticket.sale.event.title,
    performanceDate: ticket.sale.event.startAt?.toISOString() ?? null,
    performanceEndDate: ticket.sale.event.endAt?.toISOString() ?? null,
    venue: ticket.sale.event.venue ?? null,
    seat: buildSeatLabel(ticket.ticketType),
  }
}

function buildTicketNftMetadata(ticket: TicketWithMetadataContext): TicketNftMetadata {
  const summary = buildTicketMetadataSummary(ticket)
  const ticketTypeName = ticket.ticketType?.name ?? 'Ticket'
  const ticketTypeCode = ticket.ticketType?.code ?? null
  const tokenDisplay = ticket.tokenId ?? ticket.id.slice(0, 8)
  const eventDateText = summary.performanceDate
    ? new Date(summary.performanceDate).toISOString()
    : 'TBA'
  const venueText = summary.venue ?? 'TBA'

  const attributes: TicketNftAttribute[] = [
    { trait_type: 'Performance', value: summary.performanceTitle },
    { trait_type: 'Performance Date', value: eventDateText },
    { trait_type: 'Venue', value: venueText },
    { trait_type: 'Seat', value: summary.seat },
    { trait_type: 'Ticket Type', value: ticketTypeName },
    { trait_type: 'Sale Status', value: ticket.sale.status },
    { trait_type: 'Ticket Status', value: ticket.status },
    { trait_type: 'Issued At', value: ticket.issuedAt.toISOString() },
  ]

  if (ticketTypeCode) {
    attributes.push({ trait_type: 'Ticket Type Code', value: ticketTypeCode })
  }
  if (ticket.tokenId) {
    attributes.push({ trait_type: 'Token ID', value: ticket.tokenId })
  }
  if (ticket.redeemedAt) {
    attributes.push({ trait_type: 'Redeemed At', value: ticket.redeemedAt.toISOString() })
  }

  return {
    name: `${summary.performanceTitle} - ${ticketTypeName} #${tokenDisplay}`,
    description: `NFT ticket for ${summary.performanceTitle} (${venueText}) on ${eventDateText}.`,
    image: ticket.ticketType?.metadataUri ?? null,
    external_url: null,
    attributes,
    properties: {
      ticketId: ticket.id,
      saleId: ticket.saleId,
      ownerAddress: ticket.ownerAddress,
      ownerAddrHash: ticket.ownerAddrHash,
      originTxid: ticket.originTxid,
      claimTxid: ticket.claimTxid,
      tokenId: ticket.tokenId,
      ticketTypeCode,
      ticketTypeName,
      performanceTitle: summary.performanceTitle,
      performanceDate: summary.performanceDate,
      performanceEndDate: summary.performanceEndDate,
      venue: summary.venue,
      seat: summary.seat,
      status: ticket.status,
    },
  }
}
