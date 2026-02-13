import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { createSaleSchema, ticketTypeSchema, updateTicketTypeSchema } from '../schemas/sales.js'
import {
  computeMerkleRoot,
  generateMerkleProof,
  type MerkleLeaf,
} from '@tickasting/shared'

// Re-implement allocation types locally (shared between api and indexer)
interface AllocationWinner {
  finalRank: number
  txid: string
  acceptingBlockHash: string | null
  acceptingBlueScore: string | null
  confirmations: number
  buyerAddrHash: string | null
}

interface AllocationSnapshot {
  saleId: string
  network: string
  treasuryAddress: string
  ticketPriceSompi: string
  supplyTotal: number
  finalityDepth: number
  pow: { algo: string; difficulty: number }
  orderingRule: { primary: string; tiebreaker: string }
  generatedAt: string
  totalAttempts: number
  validAttempts: number
  winners: AllocationWinner[]
  losersCount: number
  merkleRoot: string | null
  commitTxid: string | null
}

export async function salesRoutes(fastify: FastifyInstance) {
  // Create sale for an event
  fastify.post<{ Params: { eventId: string } }>(
    '/v1/events/:eventId/sales',
    async (request, reply) => {
      const { eventId } = request.params

      // Check event exists
      const event = await prisma.event.findUnique({ where: { id: eventId } })
      if (!event) {
        reply.status(404)
        return { error: 'Event not found' }
      }

      const parseResult = createSaleSchema.safeParse(request.body)
      if (!parseResult.success) {
        reply.status(400)
        return { error: 'Validation failed', details: parseResult.error.flatten() }
      }

      const data = parseResult.data

      // Validate ticket type codes are unique if provided
      if (data.ticketTypes && data.ticketTypes.length > 0) {
        const codes = data.ticketTypes.map((tt) => tt.code)
        const uniqueCodes = new Set(codes)
        if (uniqueCodes.size !== codes.length) {
          reply.status(400)
          return { error: 'Duplicate ticket type codes are not allowed' }
        }
      }

      const sale = await prisma.sale.create({
        data: {
          eventId,
          network: data.network,
          treasuryAddress: data.treasuryAddress,
          ticketPriceSompi: BigInt(data.ticketPriceSompi),
          supplyTotal: data.supplyTotal,
          maxPerAddress: data.maxPerAddress,
          powDifficulty: data.powDifficulty,
          finalityDepth: data.finalityDepth,
          fallbackEnabled: data.fallbackEnabled,
          startAt: data.startAt ? new Date(data.startAt) : null,
          endAt: data.endAt ? new Date(data.endAt) : null,
          status: 'scheduled',
          ticketTypes: data.ticketTypes
            ? {
                create: data.ticketTypes.map((tt, i) => ({
                  code: tt.code,
                  name: tt.name,
                  priceSompi: BigInt(tt.priceSompi),
                  supply: tt.supply,
                  metadataUri: tt.metadataUri,
                  perk: tt.perk ?? undefined,
                  sortOrder: tt.sortOrder ?? i,
                })),
              }
            : undefined,
        },
        include: { ticketTypes: { orderBy: { sortOrder: 'asc' } } },
      })

      reply.status(201)
      return formatSaleWithTypes(sale)
    }
  )

  // Get sale by ID
  fastify.get<{ Params: { saleId: string } }>('/v1/sales/:saleId', async (request, reply) => {
    const { saleId } = request.params

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        event: true,
        ticketTypes: { orderBy: { sortOrder: 'asc' } },
      },
    })

    if (!sale) {
      reply.status(404)
      return { error: 'Sale not found' }
    }

    return {
      ...formatSaleWithTypes(sale),
      eventTitle: sale.event.title,
    }
  })

  // Get ticket types for a sale
  fastify.get<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/ticket-types',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      const ticketTypes = await prisma.ticketType.findMany({
        where: { saleId },
        orderBy: { sortOrder: 'asc' },
      })

      // Get minted counts per type
      const mintedCounts = await prisma.ticket.groupBy({
        by: ['ticketTypeId'],
        where: { saleId, status: { not: 'cancelled' } },
        _count: true,
      })
      const mintedMap = new Map(mintedCounts.map((m) => [m.ticketTypeId, m._count]))

      return {
        saleId,
        ticketTypes: ticketTypes.map((tt) => ({
          ...formatTicketType(tt),
          minted: mintedMap.get(tt.id) ?? 0,
          remaining: tt.supply - (mintedMap.get(tt.id) ?? 0),
        })),
      }
    }
  )

  // Create a ticket type for a sale
  fastify.post<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/ticket-types',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      if (sale.status !== 'scheduled') {
        reply.status(400)
        return { error: 'Cannot add ticket types after sale is published' }
      }

      const parseResult = ticketTypeSchema.safeParse(request.body)
      if (!parseResult.success) {
        reply.status(400)
        return { error: 'Validation failed', details: parseResult.error.flatten() }
      }

      const data = parseResult.data

      // Check for duplicate code
      const existing = await prisma.ticketType.findUnique({
        where: { saleId_code: { saleId, code: data.code } },
      })
      if (existing) {
        reply.status(409)
        return { error: `Ticket type code '${data.code}' already exists for this sale` }
      }

      const ticketType = await prisma.ticketType.create({
        data: {
          saleId,
          code: data.code,
          name: data.name,
          priceSompi: BigInt(data.priceSompi),
          supply: data.supply,
          metadataUri: data.metadataUri,
          perk: data.perk ?? undefined,
          sortOrder: data.sortOrder ?? 0,
        },
      })

      reply.status(201)
      return formatTicketType(ticketType)
    }
  )

  // Update a ticket type
  fastify.patch<{ Params: { saleId: string; ticketTypeId: string } }>(
    '/v1/sales/:saleId/ticket-types/:ticketTypeId',
    async (request, reply) => {
      const { saleId, ticketTypeId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      if (sale.status !== 'scheduled') {
        reply.status(400)
        return { error: 'Cannot modify ticket types after sale is published' }
      }

      const tt = await prisma.ticketType.findFirst({
        where: { id: ticketTypeId, saleId },
      })
      if (!tt) {
        reply.status(404)
        return { error: 'Ticket type not found' }
      }

      const parseResult = updateTicketTypeSchema.safeParse(request.body)
      if (!parseResult.success) {
        reply.status(400)
        return { error: 'Validation failed', details: parseResult.error.flatten() }
      }

      const data = parseResult.data

      const updated = await prisma.ticketType.update({
        where: { id: ticketTypeId },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.priceSompi !== undefined && { priceSompi: BigInt(data.priceSompi) }),
          ...(data.supply !== undefined && { supply: data.supply }),
          ...(data.metadataUri !== undefined && { metadataUri: data.metadataUri }),
          ...(data.perk !== undefined && { perk: data.perk }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        },
      })

      return formatTicketType(updated)
    }
  )

  // Publish sale (scheduled -> live)
  fastify.post<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/publish',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      // State machine: only scheduled -> live
      if (sale.status !== 'scheduled') {
        reply.status(400)
        return {
          error: 'Invalid state transition',
          message: `Cannot publish sale in status '${sale.status}'. Must be 'scheduled'.`,
        }
      }

      const updated = await prisma.sale.update({
        where: { id: saleId },
        data: { status: 'live' },
      })

      return {
        message: 'Sale published successfully',
        sale: formatSale(updated),
      }
    }
  )

  // Finalize sale (live -> finalizing)
  fastify.post<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/finalize',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      // State machine: only live -> finalizing
      if (sale.status !== 'live') {
        reply.status(400)
        return {
          error: 'Invalid state transition',
          message: `Cannot finalize sale in status '${sale.status}'. Must be 'live'.`,
        }
      }

      const updated = await prisma.sale.update({
        where: { id: saleId },
        data: { status: 'finalizing' },
      })

      return {
        message: 'Sale finalization started',
        sale: formatSale(updated),
      }
    }
  )

  // List sales (optional filter by event)
  fastify.get<{ Querystring: { eventId?: string } }>('/v1/sales', async (request) => {
    const { eventId } = request.query

    const sales = await prisma.sale.findMany({
      where: eventId ? { eventId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        event: { select: { title: true } },
        ticketTypes: { orderBy: { sortOrder: 'asc' } },
      },
    })

    return {
      sales: sales.map((s) => ({
        ...formatSaleWithTypes(s),
        eventTitle: s.event.title,
      })),
    }
  })

  // Get my purchase status by txid
  fastify.get<{ Params: { saleId: string }; Querystring: { txid: string } }>(
    '/v1/sales/:saleId/my-status',
    async (request, reply) => {
      const { saleId } = request.params
      const { txid } = request.query

      if (!txid) {
        reply.status(400)
        return { error: 'txid query parameter is required' }
      }

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      const attempt = await prisma.purchaseAttempt.findFirst({
        where: { saleId, txid },
      })

      if (!attempt) {
        return {
          found: false,
          saleId,
          txid,
          message: 'Transaction not found. It may not have been detected yet.',
        }
      }

      return {
        found: true,
        saleId,
        txid: attempt.txid,
        validationStatus: attempt.validationStatus,
        invalidReason: attempt.invalidReason,
        accepted: attempt.accepted,
        confirmations: attempt.confirmations,
        provisionalRank: attempt.provisionalRank,
        finalRank: attempt.finalRank,
        isWinner:
          attempt.finalRank !== null && attempt.finalRank <= sale.supplyTotal,
        isFallback: attempt.validationStatus === 'valid_fallback',
        acceptingBlockHash: attempt.acceptingBlockHash,
        detectedAt: attempt.detectedAt.toISOString(),
        lastCheckedAt: attempt.lastCheckedAt?.toISOString() ?? null,
      }
    }
  )

  // Get allocation snapshot (winners list)
  fastify.get<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/allocation',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      // Get all valid, accepted, final attempts
      // Include both 'valid' and 'valid_fallback' statuses
      const attempts = await prisma.purchaseAttempt.findMany({
        where: {
          saleId,
          validationStatus: { in: ['valid', 'valid_fallback'] },
          accepted: true,
          confirmations: { gte: sale.finalityDepth },
        },
        orderBy: [{ acceptingBlueScore: 'asc' }, { txid: 'asc' }],
      })

      // Get total counts
      const [totalAttempts, validAttempts] = await Promise.all([
        prisma.purchaseAttempt.count({ where: { saleId } }),
        prisma.purchaseAttempt.count({ where: { saleId, validationStatus: { in: ['valid', 'valid_fallback'] } } }),
      ])

      // Build winners list
      const winners: AllocationWinner[] = attempts
        .slice(0, sale.supplyTotal)
        .map((a, i) => ({
          finalRank: i + 1,
          txid: a.txid,
          acceptingBlockHash: a.acceptingBlockHash,
          acceptingBlueScore: a.acceptingBlueScore?.toString() ?? null,
          confirmations: a.confirmations,
          buyerAddrHash: a.buyerAddrHash,
        }))

      // Compute merkle root from winners
      const merkleLeaves: MerkleLeaf[] = winners.map((w) => ({
        finalRank: w.finalRank,
        txid: w.txid,
        acceptingBlockHash: w.acceptingBlockHash,
        acceptingBlueScore: w.acceptingBlueScore,
        buyerAddrHash: w.buyerAddrHash,
      }))
      const computedMerkleRoot = winners.length > 0 ? computeMerkleRoot(merkleLeaves) : null

      // If sale has merkle root in DB, use it; otherwise use computed
      const merkleRoot = sale.merkleRoot ?? computedMerkleRoot

      const snapshot: AllocationSnapshot = {
        saleId: sale.id,
        network: sale.network,
        treasuryAddress: sale.treasuryAddress,
        ticketPriceSompi: sale.ticketPriceSompi.toString(),
        supplyTotal: sale.supplyTotal,
        finalityDepth: sale.finalityDepth,
        pow: { algo: 'sha256', difficulty: sale.powDifficulty },
        orderingRule: {
          primary: 'acceptingBlockHash.blueScore asc',
          tiebreaker: 'txid lexicographic asc',
        },
        generatedAt: new Date().toISOString(),
        totalAttempts,
        validAttempts,
        winners,
        losersCount: Math.max(0, attempts.length - sale.supplyTotal),
        merkleRoot,
        commitTxid: sale.commitTxid,
      }

      return snapshot
    }
  )

  // Get sale stats
  fastify.get<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/stats',
    async (request, reply) => {
      const { saleId } = request.params

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      const [totalAttempts, validAttempts, acceptedAttempts, finalAttempts] =
        await Promise.all([
          prisma.purchaseAttempt.count({ where: { saleId } }),
          prisma.purchaseAttempt.count({
            where: { saleId, validationStatus: { in: ['valid', 'valid_fallback'] } },
          }),
          prisma.purchaseAttempt.count({
            where: { saleId, validationStatus: { in: ['valid', 'valid_fallback'] }, accepted: true },
          }),
          prisma.purchaseAttempt.count({
            where: {
              saleId,
              validationStatus: { in: ['valid', 'valid_fallback'] },
              accepted: true,
              confirmations: { gte: sale.finalityDepth },
            },
          }),
        ])

      return {
        saleId,
        status: sale.status,
        supplyTotal: sale.supplyTotal,
        remaining: Math.max(0, sale.supplyTotal - finalAttempts),
        totalAttempts,
        validAttempts,
        acceptedAttempts,
        finalAttempts,
        finalityDepth: sale.finalityDepth,
        timestamp: new Date().toISOString(),
      }
    }
  )

  // Register commit tx for a finalized sale
  const registerCommitSchema = z.object({
    commitTxid: z.string().min(1, 'commitTxid is required'),
  })

  fastify.post<{ Params: { saleId: string } }>(
    '/v1/sales/:saleId/commit',
    async (request, reply) => {
      const { saleId } = request.params

      const parseResult = registerCommitSchema.safeParse(request.body)
      if (!parseResult.success) {
        reply.status(400)
        return { error: 'Validation failed', details: parseResult.error.flatten() }
      }

      const { commitTxid } = parseResult.data

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      // Must be finalized or finalizing to commit
      if (sale.status !== 'finalized' && sale.status !== 'finalizing') {
        reply.status(400)
        return {
          error: 'Invalid state',
          message: `Cannot commit for sale in status '${sale.status}'. Must be 'finalizing' or 'finalized'.`,
        }
      }

      // Compute merkle root from winners if not already set
      let merkleRoot = sale.merkleRoot
      if (!merkleRoot) {
        const attempts = await prisma.purchaseAttempt.findMany({
          where: {
            saleId,
            validationStatus: { in: ['valid', 'valid_fallback'] },
            accepted: true,
            confirmations: { gte: sale.finalityDepth },
          },
          orderBy: [{ acceptingBlueScore: 'asc' }, { txid: 'asc' }],
        })

        const winners = attempts.slice(0, sale.supplyTotal)
        const merkleLeaves: MerkleLeaf[] = winners.map((a, i) => ({
          finalRank: i + 1,
          txid: a.txid,
          acceptingBlockHash: a.acceptingBlockHash,
          acceptingBlueScore: a.acceptingBlueScore?.toString() ?? null,
          buyerAddrHash: a.buyerAddrHash,
        }))

        merkleRoot = winners.length > 0 ? computeMerkleRoot(merkleLeaves) : null
      }

      // Update sale with commit txid and merkle root
      const updated = await prisma.sale.update({
        where: { id: saleId },
        data: {
          commitTxid,
          merkleRoot,
          status: 'finalized',
        },
      })

      return {
        message: 'Commit transaction registered successfully',
        saleId: updated.id,
        merkleRoot: updated.merkleRoot,
        commitTxid: updated.commitTxid,
      }
    }
  )

  // Get merkle proof for a specific winner
  fastify.get<{ Params: { saleId: string }; Querystring: { txid: string } }>(
    '/v1/sales/:saleId/merkle-proof',
    async (request, reply) => {
      const { saleId } = request.params
      const { txid } = request.query

      if (!txid) {
        reply.status(400)
        return { error: 'txid query parameter is required' }
      }

      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        reply.status(404)
        return { error: 'Sale not found' }
      }

      // Get all final winners
      const attempts = await prisma.purchaseAttempt.findMany({
        where: {
          saleId,
          validationStatus: { in: ['valid', 'valid_fallback'] },
          accepted: true,
          confirmations: { gte: sale.finalityDepth },
        },
        orderBy: [{ acceptingBlueScore: 'asc' }, { txid: 'asc' }],
      })

      const winners = attempts.slice(0, sale.supplyTotal)

      // Find the requested txid
      const leafIndex = winners.findIndex((w) => w.txid.toLowerCase() === txid.toLowerCase())
      if (leafIndex === -1) {
        return {
          found: false,
          txid,
          message: 'Transaction is not a winner or not yet finalized',
        }
      }

      // Build merkle leaves
      const merkleLeaves: MerkleLeaf[] = winners.map((a, i) => ({
        finalRank: i + 1,
        txid: a.txid,
        acceptingBlockHash: a.acceptingBlockHash,
        acceptingBlueScore: a.acceptingBlueScore?.toString() ?? null,
        buyerAddrHash: a.buyerAddrHash,
      }))

      // Generate proof
      const proof = generateMerkleProof(merkleLeaves, leafIndex)
      if (!proof) {
        reply.status(500)
        return { error: 'Failed to generate merkle proof' }
      }

      return {
        found: true,
        txid,
        finalRank: leafIndex + 1,
        leaf: merkleLeaves[leafIndex],
        proof: proof.proof,
        merkleRoot: proof.root,
        commitTxid: sale.commitTxid,
      }
    }
  )
}

interface SaleRecord {
  id: string
  eventId: string
  network: string
  treasuryAddress: string
  ticketPriceSompi: bigint
  supplyTotal: number
  maxPerAddress: number | null
  powDifficulty: number
  finalityDepth: number
  fallbackEnabled: boolean
  startAt: Date | null
  endAt: Date | null
  status: string
  merkleRoot: string | null
  commitTxid: string | null
  claimContractAddress: string | null
  createdAt: Date
}

interface TicketTypeRecord {
  id: string
  saleId: string
  code: string
  name: string
  priceSompi: bigint
  supply: number
  metadataUri: string | null
  perk: unknown
  sortOrder: number
  createdAt: Date
}

function formatSale(sale: SaleRecord) {
  return {
    id: sale.id,
    eventId: sale.eventId,
    network: sale.network,
    treasuryAddress: sale.treasuryAddress,
    ticketPriceSompi: sale.ticketPriceSompi.toString(),
    supplyTotal: sale.supplyTotal,
    maxPerAddress: sale.maxPerAddress,
    powDifficulty: sale.powDifficulty,
    finalityDepth: sale.finalityDepth,
    fallbackEnabled: sale.fallbackEnabled,
    startAt: sale.startAt?.toISOString() ?? null,
    endAt: sale.endAt?.toISOString() ?? null,
    status: sale.status,
    merkleRoot: sale.merkleRoot,
    commitTxid: sale.commitTxid,
    claimContractAddress: sale.claimContractAddress,
    createdAt: sale.createdAt.toISOString(),
  }
}

function formatSaleWithTypes(sale: SaleRecord & { ticketTypes: TicketTypeRecord[] }) {
  return {
    ...formatSale(sale),
    ticketTypes: sale.ticketTypes.map(formatTicketType),
  }
}

function formatTicketType(tt: TicketTypeRecord) {
  return {
    id: tt.id,
    saleId: tt.saleId,
    code: tt.code,
    name: tt.name,
    priceSompi: tt.priceSompi.toString(),
    supply: tt.supply,
    metadataUri: tt.metadataUri,
    perk: tt.perk,
    sortOrder: tt.sortOrder,
    createdAt: tt.createdAt.toISOString(),
  }
}
