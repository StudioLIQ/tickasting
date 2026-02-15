import type { FastifyInstance } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { prisma } from '../db.js'
import { getEvmSaleComputed, findEvmAttemptByTxid, useEvmPurchases } from '../evm-purchases.js'

interface SaleStats {
  saleId: string
  status: string
  supplyTotal: number
  remaining: number
  totalAttempts: number
  validAttempts: number
  acceptedAttempts: number
  finalAttempts: number
  timestamp: string
}

// Store active connections per sale
const saleConnections = new Map<string, Set<WebSocket>>()

export async function websocketRoutes(fastify: FastifyInstance) {
  // WebSocket endpoint for sale updates
  fastify.get<{ Params: { saleId: string } }>(
    '/ws/sales/:saleId',
    { websocket: true },
    async (socket, request) => {
      const { saleId } = request.params

      // Verify sale exists
      const sale = await prisma.sale.findUnique({ where: { id: saleId } })
      if (!sale) {
        socket.send(JSON.stringify({ type: 'error', message: 'Sale not found' }))
        socket.close()
        return
      }

      // Add to connection pool
      if (!saleConnections.has(saleId)) {
        saleConnections.set(saleId, new Set())
      }
      saleConnections.get(saleId)!.add(socket)

      fastify.log.info(`WebSocket connected for sale ${saleId}`)

      // Send initial stats
      const stats = await getSaleStats(saleId)
      socket.send(JSON.stringify({ type: 'stats', data: stats }))

      // Handle messages from client
      socket.on('message', async (message: Buffer | string) => {
        try {
          const data = JSON.parse(message.toString())

          if (data.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }))
          } else if (data.type === 'get_stats') {
            const stats = await getSaleStats(saleId)
            socket.send(JSON.stringify({ type: 'stats', data: stats }))
          } else if (data.type === 'get_my_status' && data.txid) {
            const status = await getMyStatus(saleId, data.txid)
            socket.send(JSON.stringify({ type: 'my_status', data: status }))
          }
        } catch {
          socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' }))
        }
      })

      // Handle disconnect
      socket.on('close', () => {
        saleConnections.get(saleId)?.delete(socket)
        if (saleConnections.get(saleId)?.size === 0) {
          saleConnections.delete(saleId)
        }
        fastify.log.info(`WebSocket disconnected for sale ${saleId}`)
      })

      socket.on('error', (err: Error) => {
        fastify.log.error({ err }, `WebSocket error for sale ${saleId}`)
        saleConnections.get(saleId)?.delete(socket)
      })
    }
  )

  // Start periodic stats broadcast
  const BROADCAST_INTERVAL_MS = parseInt(
    process.env['WS_BROADCAST_INTERVAL_MS'] || '2000',
    10
  )

  const broadcastInterval = setInterval(async () => {
    for (const [saleId, connections] of saleConnections) {
      if (connections.size === 0) continue

      try {
        const stats = await getSaleStats(saleId)
        const message = JSON.stringify({ type: 'stats', data: stats })

        for (const socket of connections) {
          if (socket.readyState === 1) {
            // OPEN
            socket.send(message)
          }
        }
      } catch (err) {
        fastify.log.error({ err }, `Failed to broadcast stats for sale ${saleId}`)
      }
    }
  }, BROADCAST_INTERVAL_MS)

  // Cleanup on server close
  fastify.addHook('onClose', () => {
    clearInterval(broadcastInterval)
    for (const connections of saleConnections.values()) {
      for (const socket of connections) {
        socket.close()
      }
    }
    saleConnections.clear()
  })
}

async function getSaleStats(saleId: string): Promise<SaleStats | null> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) return null

  let totalAttempts = 0
  let validAttempts = 0
  let acceptedAttempts = 0
  let finalAttempts = 0

  if (useEvmPurchases()) {
    const computed = await getEvmSaleComputed(sale)
    totalAttempts = computed.attempts.length
    validAttempts = computed.validAttempts.length
    acceptedAttempts = computed.validAttempts.length
    finalAttempts = computed.finalAttempts.length
  } else {
    ;[totalAttempts, validAttempts, acceptedAttempts, finalAttempts] =
      await Promise.all([
        prisma.purchaseAttempt.count({ where: { saleId } }),
        prisma.purchaseAttempt.count({
          where: { saleId, validationStatus: 'valid' },
        }),
        prisma.purchaseAttempt.count({
          where: { saleId, validationStatus: 'valid', accepted: true },
        }),
        prisma.purchaseAttempt.count({
          where: {
            saleId,
            validationStatus: 'valid',
            accepted: true,
            confirmations: { gte: sale.finalityDepth },
          },
        }),
      ])
  }

  return {
    saleId,
    status: sale.status,
    supplyTotal: sale.supplyTotal,
    remaining: Math.max(0, sale.supplyTotal - finalAttempts),
    totalAttempts,
    validAttempts,
    acceptedAttempts,
    finalAttempts,
    timestamp: new Date().toISOString(),
  }
}

async function getMyStatus(saleId: string, txid: string) {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } })
  if (!sale) return { found: false, message: 'Sale not found' }

  if (useEvmPurchases()) {
    const attempt = await findEvmAttemptByTxid(sale, txid)
    if (!attempt) {
      return {
        found: false,
        txid,
        message: 'Transaction not found',
      }
    }

    return {
      found: true,
      txid: attempt.txid,
      validationStatus: attempt.validationStatus,
      invalidReason: attempt.invalidReason,
      accepted: attempt.accepted,
      confirmations: attempt.confirmations,
      provisionalRank: attempt.provisionalRank,
      finalRank: attempt.finalRank,
      isWinner:
        attempt.finalRank !== null && attempt.finalRank <= sale.supplyTotal,
      acceptingBlockHash: attempt.blockHash,
      detectedAt: new Date(Number(attempt.blockTimestamp) * 1000).toISOString(),
    }
  }

  const attempt = await prisma.purchaseAttempt.findFirst({
    where: { saleId, txid },
  })

  if (!attempt) {
    return {
      found: false,
      txid,
      message: 'Transaction not found',
    }
  }

  return {
    found: true,
    txid: attempt.txid,
    validationStatus: attempt.validationStatus,
    invalidReason: attempt.invalidReason,
    accepted: attempt.accepted,
    confirmations: attempt.confirmations,
    provisionalRank: attempt.provisionalRank,
    finalRank: attempt.finalRank,
    isWinner:
      attempt.finalRank !== null && attempt.finalRank <= sale.supplyTotal,
    acceptingBlockHash: attempt.acceptingBlockHash,
    detectedAt: attempt.detectedAt.toISOString(),
  }
}

// Export for external use (e.g., indexer notifications)
export function broadcastToSale(saleId: string, message: object) {
  const connections = saleConnections.get(saleId)
  if (!connections) return

  const msgStr = JSON.stringify(message)
  for (const socket of connections) {
    if (socket.readyState === 1) {
      socket.send(msgStr)
    }
  }
}
