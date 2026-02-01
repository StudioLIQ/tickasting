import Fastify from 'fastify'
import cors from '@fastify/cors'

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

  // Health check endpoint
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    }
  })

  // Placeholder routes (will be implemented in later tickets)
  fastify.get('/v1/sales/:saleId', async (request, reply) => {
    const { saleId } = request.params as { saleId: string }
    reply.status(501)
    return { error: 'Not implemented', saleId }
  })

  try {
    await fastify.listen({ port: PORT, host: HOST })
    console.log(`API server listening on http://${HOST}:${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

main()
