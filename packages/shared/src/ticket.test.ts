/**
 * Ticket QR Tests
 */

import { describe, it, expect } from 'vitest'
import {
  signTicketData,
  verifyTicketSignature,
  encodeTicketQR,
  decodeTicketQR,
  type TicketQRData,
} from './ticket.js'

const testSecret = 'test-secret-key-for-tickets'
const sampleData: TicketQRData = {
  ticketId: '123e4567-e89b-12d3-a456-426614174000',
  saleId: '223e4567-e89b-12d3-a456-426614174001',
  txid: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
}

describe('ticket', () => {
  describe('signTicketData', () => {
    it('should produce consistent signatures', () => {
      const sig1 = signTicketData(sampleData, testSecret)
      const sig2 = signTicketData(sampleData, testSecret)
      expect(sig1).toBe(sig2)
    })

    it('should produce different signatures for different data', () => {
      const sig1 = signTicketData(sampleData, testSecret)
      const sig2 = signTicketData({ ...sampleData, ticketId: 'different' }, testSecret)
      expect(sig1).not.toBe(sig2)
    })

    it('should produce different signatures for different secrets', () => {
      const sig1 = signTicketData(sampleData, testSecret)
      const sig2 = signTicketData(sampleData, 'different-secret')
      expect(sig1).not.toBe(sig2)
    })
  })

  describe('verifyTicketSignature', () => {
    it('should verify valid signature', () => {
      const signature = signTicketData(sampleData, testSecret)
      expect(verifyTicketSignature(sampleData, signature, testSecret)).toBe(true)
    })

    it('should reject invalid signature', () => {
      const signature = signTicketData(sampleData, testSecret)
      expect(verifyTicketSignature(sampleData, signature + 'x', testSecret)).toBe(false)
    })

    it('should reject signature with wrong secret', () => {
      const signature = signTicketData(sampleData, testSecret)
      expect(verifyTicketSignature(sampleData, signature, 'wrong-secret')).toBe(false)
    })

    it('should reject tampered data', () => {
      const signature = signTicketData(sampleData, testSecret)
      const tamperedData = { ...sampleData, ticketId: 'tampered' }
      expect(verifyTicketSignature(tamperedData, signature, testSecret)).toBe(false)
    })
  })

  describe('encodeTicketQR', () => {
    it('should encode ticket data to QR string', () => {
      const qr = encodeTicketQR(sampleData, testSecret)
      expect(qr.startsWith('GP1|')).toBe(true)
      expect(qr.split('|').length).toBe(5)
    })

    it('should include all fields', () => {
      const qr = encodeTicketQR(sampleData, testSecret)
      expect(qr).toContain(sampleData.ticketId)
      expect(qr).toContain(sampleData.saleId)
      expect(qr).toContain(sampleData.txid)
    })
  })

  describe('decodeTicketQR', () => {
    it('should decode valid QR string', () => {
      const qr = encodeTicketQR(sampleData, testSecret)
      const result = decodeTicketQR(qr, testSecret)

      expect(result.valid).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.data?.ticketId).toBe(sampleData.ticketId)
      expect(result.data?.saleId).toBe(sampleData.saleId)
      expect(result.data?.txid).toBe(sampleData.txid)
    })

    it('should reject invalid format', () => {
      const result = decodeTicketQR('invalid', testSecret)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('wrong number of parts')
    })

    it('should reject wrong magic', () => {
      const qr = encodeTicketQR(sampleData, testSecret).replace('GP1', 'GP2')
      const result = decodeTicketQR(qr, testSecret)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('wrong magic')
    })

    it('should reject tampered signature', () => {
      const qr = encodeTicketQR(sampleData, testSecret)
      const tamperedQr = qr.slice(0, -5) + 'xxxxx'
      const result = decodeTicketQR(tamperedQr, testSecret)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid signature')
    })

    it('should reject with wrong secret', () => {
      const qr = encodeTicketQR(sampleData, testSecret)
      const result = decodeTicketQR(qr, 'wrong-secret')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid signature')
    })
  })
})
