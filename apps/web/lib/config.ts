/**
 * Web App Configuration
 */

import { PUBLIC_API_URL, PUBLIC_WEB_HOSTS, PUBLIC_WS_URL } from './public-runtime'

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
  if (
    typeof window !== 'undefined' &&
    PUBLIC_WEB_HOSTS.includes(window.location.hostname as (typeof PUBLIC_WEB_HOSTS)[number])
  ) {
    return PUBLIC_API_URL
  }

  return LOCAL_API_HTTP
}

function resolveWsBaseUrl(apiBaseUrl: string): string {
  if (apiBaseUrl === PUBLIC_API_URL) {
    return trimTrailingSlash(PUBLIC_WS_URL)
  }

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
