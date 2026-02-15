import { prisma } from './db.js'
import { buildApiServer } from './app.js'

const PORT = parseInt(process.env['PORT'] || process.env['API_PORT'] || '4001', 10)
const HOST = process.env['API_HOST'] || '0.0.0.0'

async function main() {
  const fastify = await buildApiServer()

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
