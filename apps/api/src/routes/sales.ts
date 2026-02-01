import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { createSaleSchema } from '../schemas/sales.js'

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
          startAt: data.startAt ? new Date(data.startAt) : null,
          endAt: data.endAt ? new Date(data.endAt) : null,
          status: 'scheduled',
        },
      })

      reply.status(201)
      return formatSale(sale)
    }
  )

  // Get sale by ID
  fastify.get<{ Params: { saleId: string } }>('/v1/sales/:saleId', async (request, reply) => {
    const { saleId } = request.params

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { event: true },
    })

    if (!sale) {
      reply.status(404)
      return { error: 'Sale not found' }
    }

    return {
      ...formatSale(sale),
      eventTitle: sale.event.title,
    }
  })

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
      include: { event: { select: { title: true } } },
    })

    return {
      sales: sales.map((s) => ({
        ...formatSale(s),
        eventTitle: s.event.title,
      })),
    }
  })
}

function formatSale(sale: {
  id: string
  eventId: string
  network: string
  treasuryAddress: string
  ticketPriceSompi: bigint
  supplyTotal: number
  maxPerAddress: number | null
  powDifficulty: number
  finalityDepth: number
  startAt: Date | null
  endAt: Date | null
  status: string
  merkleRoot: string | null
  commitTxid: string | null
  createdAt: Date
}) {
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
    startAt: sale.startAt?.toISOString() ?? null,
    endAt: sale.endAt?.toISOString() ?? null,
    status: sale.status,
    merkleRoot: sale.merkleRoot,
    commitTxid: sale.commitTxid,
    createdAt: sale.createdAt.toISOString(),
  }
}
