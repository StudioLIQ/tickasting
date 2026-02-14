/**
 * Ticket QR Code utilities
 *
 * QR contains: ticketId|saleId|txid|signature
 * Signature: HMAC-SHA256(ticketId|saleId|txid, secret)
 */

import { createHmac, timingSafeEqual } from 'crypto'

export interface TicketQRData {
  ticketId: string
  saleId: string
  txid: string
}

export interface SignedTicketQR extends TicketQRData {
  signature: string
}

/**
 * Create HMAC signature for ticket
 */
export function signTicketData(data: TicketQRData, secret: string): string {
  const message = `${data.ticketId}|${data.saleId}|${data.txid}`
  const hmac = createHmac('sha256', secret)
  hmac.update(message)
  return hmac.digest('hex')
}

/**
 * Verify ticket signature
 */
export function verifyTicketSignature(
  data: TicketQRData,
  signature: string,
  secret: string
): boolean {
  const expected = signTicketData(data, secret)
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

/**
 * Encode ticket data to QR string
 * Format: TK1|{ticketId}|{saleId}|{txid}|{signature}
 */
export function encodeTicketQR(data: TicketQRData, secret: string): string {
  const signature = signTicketData(data, secret)
  return `TK1|${data.ticketId}|${data.saleId}|${data.txid}|${signature}`
}

/**
 * Decode and verify ticket QR string
 */
export function decodeTicketQR(
  qrString: string,
  secret: string
): { valid: boolean; data?: SignedTicketQR; error?: string } {
  const parts = qrString.split('|')

  if (parts.length !== 5) {
    return { valid: false, error: 'Invalid QR format: wrong number of parts' }
  }

  const [magic, ticketId, saleId, txid, signature] = parts

  if (magic !== 'TK1') {
    return { valid: false, error: 'Invalid QR format: wrong magic' }
  }

  if (!ticketId || !saleId || !txid || !signature) {
    return { valid: false, error: 'Invalid QR format: missing fields' }
  }

  const data: TicketQRData = { ticketId, saleId, txid }

  if (!verifyTicketSignature(data, signature, secret)) {
    return { valid: false, error: 'Invalid signature' }
  }

  return {
    valid: true,
    data: { ...data, signature },
  }
}
