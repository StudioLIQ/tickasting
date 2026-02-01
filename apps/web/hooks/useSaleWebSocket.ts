'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { config } from '@/lib/config'
import type { SaleStats, MyStatus } from '@/lib/api'

interface WebSocketMessage {
  type: string
  data?: unknown
  message?: string
}

export interface UseSaleWebSocketResult {
  connected: boolean
  stats: SaleStats | null
  myStatus: MyStatus | null
  error: string | null
  requestStats: () => void
  requestMyStatus: (txid: string) => void
}

export function useSaleWebSocket(saleId: string): UseSaleWebSocketResult {
  const [connected, setConnected] = useState(false)
  const [stats, setStats] = useState<SaleStats | null>(null)
  const [myStatus, setMyStatus] = useState<MyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const wsUrl = `${config.wsBaseUrl}/ws/sales/${saleId}`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setConnected(true)
      setError(null)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WebSocketMessage

        switch (msg.type) {
          case 'stats':
            setStats(msg.data as SaleStats)
            break
          case 'my_status':
            setMyStatus(msg.data as MyStatus)
            break
          case 'error':
            setError(msg.message || 'WebSocket error')
            break
          case 'pong':
            // Heartbeat response, ignore
            break
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null

      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      setError('WebSocket connection error')
    }

    wsRef.current = ws
  }, [saleId])

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      wsRef.current?.close()
    }
  }, [connect])

  // Ping every 30 seconds to keep connection alive
  useEffect(() => {
    if (!connected) return

    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [connected])

  const requestStats = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'get_stats' }))
    }
  }, [])

  const requestMyStatus = useCallback((txid: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'get_my_status', txid }))
    }
  }, [])

  return {
    connected,
    stats,
    myStatus,
    error,
    requestStats,
    requestMyStatus,
  }
}
