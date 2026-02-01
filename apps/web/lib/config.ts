/**
 * Web App Configuration
 */

export const config = {
  apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4001',
  wsBaseUrl: process.env['NEXT_PUBLIC_WS_URL'] || 'ws://localhost:4001',
}
