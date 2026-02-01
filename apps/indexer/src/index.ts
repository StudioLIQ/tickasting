import Fastify from 'fastify'
import { prisma } from './db.js'
import { createScannerLoop } from './scanner.js'
import { PurchaseValidator } from './validator.js'
import { createAcceptanceTrackerLoop } from './acceptance-tracker.js'
import { KasFyiAdapter } from '@ghostpass/shared'

const PORT = parseInt(process.env['INDEXER_PORT'] || '4002', 10)
const POLL_INTERVAL_MS = parseInt(process.env['INDEXER_POLL_INTERVAL_MS'] || '5000', 10)

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

  // Test database connection
  try {
    await prisma.$connect()
    fastify.log.info('Database connected')
  } catch (error) {
    fastify.log.error({ error }, 'Database connection failed')
    process.exit(1)
  }

  // Initialize Kaspa adapter
  const kaspaNetwork = process.env['KASPA_NETWORK'] as 'mainnet' | 'testnet' | undefined
  const adapter = new KasFyiAdapter({
    network: kaspaNetwork || 'testnet',
    apiKey: process.env['KASFYI_API_KEY'],
  })

  // Health check endpoint
  fastify.get('/health', async () => {
    // Check DB connection
    let dbStatus = 'ok'
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      dbStatus = 'error'
    }

    // Get live sales count
    let liveSalesCount = 0
    try {
      liveSalesCount = await prisma.sale.count({ where: { status: 'live' } })
    } catch {
      // Ignore
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'indexer',
      timestamp: new Date().toISOString(),
      pollIntervalMs: POLL_INTERVAL_MS,
      database: dbStatus,
      liveSalesCount,
      network: kaspaNetwork || 'testnet',
    }
  })

  // Stats endpoint
  fastify.get('/stats', async () => {
    const [liveSales, pendingAttempts, totalAttempts] = await Promise.all([
      prisma.sale.count({ where: { status: 'live' } }),
      prisma.purchaseAttempt.count({ where: { validationStatus: 'pending' } }),
      prisma.purchaseAttempt.count(),
    ])

    return {
      liveSales,
      pendingAttempts,
      totalAttempts,
      timestamp: new Date().toISOString(),
    }
  })

  // Start scanner loop
  const indexerLogger = {
    info: (msg: string, data?: unknown) => fastify.log.info({ data }, msg),
    error: (msg: string, data?: unknown) => fastify.log.error({ data }, msg),
    debug: (msg: string, data?: unknown) => fastify.log.debug({ data }, msg),
  }

  const scannerLoop = createScannerLoop(prisma, adapter, POLL_INTERVAL_MS, {
    logger: indexerLogger,
  })

  // Start validator loop
  const validator = new PurchaseValidator(prisma, adapter, { logger: indexerLogger })
  let validatorRunning = true
  let validatorTimeoutId: ReturnType<typeof setTimeout> | null = null

  const runValidatorLoop = async () => {
    if (!validatorRunning) return

    try {
      const results = await validator.validatePending()
      if (results.length > 0) {
        const valid = results.filter((r) => r.status === 'valid').length
        const invalid = results.length - valid
        fastify.log.info(`Validated ${results.length} attempt(s): ${valid} valid, ${invalid} invalid`)
      }
    } catch (error) {
      fastify.log.error({ error }, 'Validator loop error')
    }

    if (validatorRunning) {
      validatorTimeoutId = setTimeout(runValidatorLoop, POLL_INTERVAL_MS)
    }
  }

  // Start validator after a short delay (to let scanner run first)
  setTimeout(runValidatorLoop, 1000)

  // Start acceptance tracker loop
  const acceptanceTrackerLoop = createAcceptanceTrackerLoop(prisma, adapter, POLL_INTERVAL_MS, {
    logger: indexerLogger,
  })

  fastify.log.info(`Scanner, Validator, and AcceptanceTracker started with ${POLL_INTERVAL_MS}ms interval`)

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...')
    scannerLoop.stop()
    validatorRunning = false
    if (validatorTimeoutId) {
      clearTimeout(validatorTimeoutId)
    }
    acceptanceTrackerLoop.stop()
    await prisma.$disconnect()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`Indexer service listening on http://0.0.0.0:${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
