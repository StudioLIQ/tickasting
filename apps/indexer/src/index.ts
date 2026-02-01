import Fastify from 'fastify'

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

  // Health check endpoint
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      service: 'indexer',
      timestamp: new Date().toISOString(),
      pollIntervalMs: POLL_INTERVAL_MS,
    }
  })

  // Placeholder: Start indexer polling loop (will be implemented in GP-006)
  console.log(`Indexer polling interval: ${POLL_INTERVAL_MS}ms`)

  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' })
    console.log(`Indexer service listening on http://0.0.0.0:${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
