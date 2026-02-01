import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import { createEventSchema } from '../schemas/events.js'

export async function eventsRoutes(fastify: FastifyInstance) {
  // Create event
  fastify.post('/v1/events', async (request, reply) => {
    const parseResult = createEventSchema.safeParse(request.body)
    if (!parseResult.success) {
      reply.status(400)
      return { error: 'Validation failed', details: parseResult.error.flatten() }
    }

    const { title, venue, startAt, endAt } = parseResult.data

    const event = await prisma.event.create({
      data: {
        organizerId: 'default-organizer', // MVP: hardcoded
        title,
        venue,
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
        status: 'draft',
      },
    })

    reply.status(201)
    return {
      id: event.id,
      title: event.title,
      venue: event.venue,
      startAt: event.startAt?.toISOString(),
      endAt: event.endAt?.toISOString(),
      status: event.status,
      createdAt: event.createdAt.toISOString(),
    }
  })

  // Get event by ID
  fastify.get<{ Params: { eventId: string } }>('/v1/events/:eventId', async (request, reply) => {
    const { eventId } = request.params

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { sales: true },
    })

    if (!event) {
      reply.status(404)
      return { error: 'Event not found' }
    }

    return {
      id: event.id,
      title: event.title,
      venue: event.venue,
      startAt: event.startAt?.toISOString(),
      endAt: event.endAt?.toISOString(),
      status: event.status,
      createdAt: event.createdAt.toISOString(),
      sales: event.sales.map((s) => ({
        id: s.id,
        status: s.status,
        supplyTotal: s.supplyTotal,
        ticketPriceSompi: s.ticketPriceSompi.toString(),
      })),
    }
  })

  // List events
  fastify.get('/v1/events', async () => {
    const events = await prisma.event.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return {
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        venue: e.venue,
        status: e.status,
        startAt: e.startAt?.toISOString(),
        endAt: e.endAt?.toISOString(),
      })),
    }
  })
}
