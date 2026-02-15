import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'
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

export async function buildApiServer(
  options: FastifyServerOptions = {}
): Promise<FastifyInstance> {
  const { logger, ...restOptions } = options

  const fastify = Fastify({
    logger: logger ?? {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
    ...restOptions,
  })

  await fastify.register(cors, { origin: true })
  await fastify.register(websocket)

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

  await fastify.register(eventsRoutes)
  await fastify.register(salesRoutes)
  await fastify.register(websocketRoutes)
  await fastify.register(scannerRoutes)
  await fastify.register(claimRoutes)

  return fastify
}
