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

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://tickasting.studioliq.com',
  'https://www.tickasting.studioliq.com',
]

function parseCorsOrigins(raw: string | undefined): { allowAll: boolean; allowed: Set<string> } {
  const values = raw
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const origins = values && values.length > 0 ? values : DEFAULT_CORS_ORIGINS
  const allowAll = origins.includes('*')
  return {
    allowAll,
    allowed: new Set(origins),
  }
}

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

  const corsConfig = parseCorsOrigins(process.env['CORS_ORIGINS'])
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow non-browser or same-origin requests that do not send Origin.
      if (!origin) {
        cb(null, true)
        return
      }

      if (corsConfig.allowAll || corsConfig.allowed.has(origin)) {
        cb(null, true)
        return
      }

      cb(new Error('Origin not allowed by CORS'), false)
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })
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
