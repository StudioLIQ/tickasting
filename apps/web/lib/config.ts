/**
 * Web App Configuration
 */

const PRODUCTION_WEB_HOST = 'tickasting.studioliq.com'
const PRODUCTION_API_HTTP = 'https://api-tickasting.studioliq.com'
const LOCAL_API_HTTP = 'http://localhost:4001'
const LOCAL_API_WS = 'ws://localhost:4001'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function toWebSocketUrl(httpOrWsUrl: string): string {
  const normalized = trimTrailingSlash(httpOrWsUrl)
  if (normalized.startsWith('ws://') || normalized.startsWith('wss://')) {
    return normalized
  }
  if (normalized.startsWith('https://')) {
    return `wss://${normalized.slice('https://'.length)}`
  }
  if (normalized.startsWith('http://')) {
    return `ws://${normalized.slice('http://'.length)}`
  }
  return normalized
}

function resolveApiBaseUrl(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_URL']?.trim()
  if (fromEnv) return trimTrailingSlash(fromEnv)

  if (typeof window !== 'undefined' && window.location.hostname === PRODUCTION_WEB_HOST) {
    return PRODUCTION_API_HTTP
  }

  return LOCAL_API_HTTP
}

function resolveWsBaseUrl(apiBaseUrl: string): string {
  const fromEnv = process.env['NEXT_PUBLIC_WS_URL']?.trim()
  if (fromEnv) return trimTrailingSlash(fromEnv)

  if (apiBaseUrl !== LOCAL_API_HTTP) {
    return toWebSocketUrl(apiBaseUrl)
  }

  return LOCAL_API_WS
}

const apiBaseUrl = resolveApiBaseUrl()

export const config = {
  apiBaseUrl,
  wsBaseUrl: resolveWsBaseUrl(apiBaseUrl),
}
