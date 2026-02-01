import Fastify from 'fastify'
import cors from '@fastify/cors'
import { prisma } from './db.js'

const PORT = parseInt(process.env['API_PORT'] || '4001', 10)
const HOST = process.env['API_HOST'] || '0.0.0.0'

async function main() {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  })

  await fastify.register(cors, { origin: true })

  // Health check endpoint with DB status
  fastify.get('/health', async () => {
    let dbStatus = 'ok'
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      dbStatus = 'error'
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'api',
      timestamp: new Date().toISOString(),
      db: dbStatus,
    }
  })

  // Placeholder routes (will be implemented in later tickets)
  fastify.get('/v1/sales/:saleId', async (request, reply) => {
    const { saleId } = request.params as { saleId: string }
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { event: true },
    })

    if (!sale) {
      reply.status(404)
      return { error: 'Sale not found', saleId }
    }

    return {
      id: sale.id,
      eventId: sale.eventId,
      eventTitle: sale.event.title,
      network: sale.network,
      treasuryAddress: sale.treasuryAddress,
      ticketPriceSompi: sale.ticketPriceSompi.toString(),
      supplyTotal: sale.supplyTotal,
      maxPerAddress: sale.maxPerAddress,
      powDifficulty: sale.powDifficulty,
      finalityDepth: sale.finalityDepth,
      startAt: sale.startAt?.toISOString(),
      endAt: sale.endAt?.toISOString(),
      status: sale.status,
    }
  })

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...')
    await prisma.$disconnect()
    await fastify.close()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  try {
    // Test DB connection on startup
    await prisma.$connect()
    fastify.log.info('Database connected')

    await fastify.listen({ port: PORT, host: HOST })
    console.log(`API server listening on http://${HOST}:${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    await prisma.$disconnect()
    process.exit(1)
  }
}

main()
