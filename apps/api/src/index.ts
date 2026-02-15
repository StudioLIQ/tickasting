import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { prisma } from './db.js'
import { USE_PONDER_DATA, ponderTablesExist } from './ponder-client.js'
import { useEvmPurchases } from './evm-purchases.js'
import { eventsRoutes } from './routes/events.js'
import { salesRoutes } from './routes/sales.js'
import { websocketRoutes } from './routes/websocket.js'
import { scannerRoutes } from './routes/scanner.js'
import { claimRoutes } from './routes/claims.js'

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
  await fastify.register(websocket)

  // Health check endpoint with DB + Ponder status
  fastify.get('/health', async () => {
    let dbStatus = 'ok'
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      dbStatus = 'error'
    }

    let ponderStatus = 'disabled'
    if (USE_PONDER_DATA) {
      ponderStatus = (await ponderTablesExist()) ? 'ok' : 'tables_missing'
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'api',
      timestamp: new Date().toISOString(),
      db: dbStatus,
      ponder: ponderStatus,
      usePonderData: USE_PONDER_DATA,
      purchaseMode: useEvmPurchases() ? 'evm' : 'legacy',
    }
  })

  // Register routes
  await fastify.register(eventsRoutes)
  await fastify.register(salesRoutes)
  await fastify.register(websocketRoutes)
  await fastify.register(scannerRoutes)
  await fastify.register(claimRoutes)

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
