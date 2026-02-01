/**
 * Purchase Attempt Validator
 *
 * Validates purchase attempts according to GhostPass rules:
 * - Amount: must match ticketPriceSompi
 * - Payload: must be valid v1 format with correct saleId
 * - PoW: must pass difficulty check
 */

import type { PrismaClient, Sale, PurchaseAttempt, ValidationStatus } from '@prisma/client'
import type { KaspaAdapter, KaspaTransaction } from '@ghostpass/shared'
import { decodePayload, PayloadError, MAGIC, PAYLOAD_VERSION, verifyPow } from '@ghostpass/shared'

export interface ValidatorConfig {
  logger?: {
    info: (msg: string, data?: unknown) => void
    error: (msg: string, data?: unknown) => void
    debug: (msg: string, data?: unknown) => void
  }
}

export interface ValidationResult {
  attemptId: string
  txid: string
  status: ValidationStatus
  invalidReason: string | null
  buyerAddrHash: string | null
}

const defaultLogger = {
  info: (msg: string, data?: unknown) => console.log(`[Validator] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[Validator] ${msg}`, data ?? ''),
  debug: (msg: string, data?: unknown) => console.log(`[Validator:debug] ${msg}`, data ?? ''),
}

/**
 * Validates purchase attempts
 */
export class PurchaseValidator {
  private readonly prisma: PrismaClient
  private readonly adapter: KaspaAdapter
  private readonly config: Required<ValidatorConfig>

  constructor(prisma: PrismaClient, adapter: KaspaAdapter, config: ValidatorConfig = {}) {
    this.prisma = prisma
    this.adapter = adapter
    this.config = {
      logger: config.logger ?? defaultLogger,
    }
  }

  /**
   * Validate all pending attempts for live sales
   */
  async validatePending(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = []

    // Get all pending attempts with their sales
    const pendingAttempts = await this.prisma.purchaseAttempt.findMany({
      where: { validationStatus: 'pending' },
      include: { sale: true },
    })

    if (pendingAttempts.length === 0) {
      this.config.logger.debug('No pending attempts to validate')
      return results
    }

    this.config.logger.info(`Validating ${pendingAttempts.length} pending attempt(s)`)

    for (const attempt of pendingAttempts) {
      const result = await this.validateAttempt(attempt, attempt.sale)
      results.push(result)

      // Update database
      await this.prisma.purchaseAttempt.update({
        where: { id: attempt.id },
        data: {
          validationStatus: result.status,
          invalidReason: result.invalidReason,
          buyerAddrHash: result.buyerAddrHash,
        },
      })
    }

    return results
  }

  /**
   * Validate a single attempt
   */
  async validateAttempt(
    attempt: PurchaseAttempt,
    sale: Sale
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      attemptId: attempt.id,
      txid: attempt.txid,
      status: 'valid',
      invalidReason: null,
      buyerAddrHash: null,
    }

    try {
      // 1. Get transaction details if we don't have enough info
      let tx: KaspaTransaction | null = null
      if (!attempt.payloadHex) {
        // Fetch full transaction to get payload and outputs
        tx = await this.adapter.getTransactionDetails(attempt.txid, true)
        if (!tx) {
          result.status = 'invalid_bad_payload'
          result.invalidReason = 'Transaction not found'
          return result
        }
      }

      // 2. Check payload exists
      const payloadHex = attempt.payloadHex ?? tx?.payload
      if (!payloadHex) {
        // Check if fallback mode is enabled for this sale
        if (sale.fallbackEnabled) {
          // Fallback mode: validate amount only, no payload/PoW required
          if (!tx) {
            tx = await this.adapter.getTransactionDetails(attempt.txid, true)
          }
          if (tx) {
            const amountValid = this.validateAmount(tx, sale.treasuryAddress, sale.ticketPriceSompi)
            if (!amountValid) {
              result.status = 'invalid_wrong_amount'
              result.invalidReason = `Amount mismatch: expected ${sale.ticketPriceSompi} sompi to ${sale.treasuryAddress}`
              return result
            }
          }
          // Mark as valid_fallback (no PoW verification)
          result.status = 'valid_fallback' as ValidationStatus
          result.buyerAddrHash = null // No buyer address hash in fallback mode
          this.config.logger.debug(`Validated attempt ${attempt.txid}: valid_fallback (no payload)`)
          return result
        }
        result.status = 'invalid_missing_payload'
        result.invalidReason = 'No payload in transaction'
        return result
      }

      // 3. Decode and validate payload
      let payload
      try {
        payload = decodePayload(payloadHex)
      } catch (err) {
        if (err instanceof PayloadError) {
          result.status = 'invalid_bad_payload'
          result.invalidReason = err.message
          return result
        }
        throw err
      }

      // 4. Validate magic
      if (payload.magic !== MAGIC) {
        result.status = 'invalid_bad_payload'
        result.invalidReason = `Invalid magic: ${payload.magic}`
        return result
      }

      // 5. Validate version
      if (payload.version !== PAYLOAD_VERSION) {
        result.status = 'invalid_bad_payload'
        result.invalidReason = `Unsupported version: ${payload.version}`
        return result
      }

      // 6. Validate saleId matches
      if (payload.saleId !== sale.id) {
        result.status = 'invalid_wrong_sale'
        result.invalidReason = `Sale ID mismatch: expected ${sale.id}, got ${payload.saleId}`
        return result
      }

      // 7. Validate PoW
      const powValid = verifyPow(
        {
          saleId: sale.id,
          buyerAddrHash: payload.buyerAddrHash,
          difficulty: sale.powDifficulty,
        },
        payload.powNonce
      )

      if (!powValid) {
        result.status = 'invalid_pow'
        result.invalidReason = `PoW failed: difficulty ${sale.powDifficulty}`
        return result
      }

      // 8. Validate amount (need tx outputs)
      if (!tx) {
        tx = await this.adapter.getTransactionDetails(attempt.txid, true)
      }

      if (tx) {
        const amountValid = this.validateAmount(tx, sale.treasuryAddress, sale.ticketPriceSompi)
        if (!amountValid) {
          result.status = 'invalid_wrong_amount'
          result.invalidReason = `Amount mismatch: expected ${sale.ticketPriceSompi} sompi to ${sale.treasuryAddress}`
          return result
        }
      }

      // All validations passed
      result.buyerAddrHash = payload.buyerAddrHash
      this.config.logger.debug(`Validated attempt ${attempt.txid}: valid`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      result.status = 'invalid_bad_payload'
      result.invalidReason = `Validation error: ${errorMsg}`
      this.config.logger.error(`Validation error for ${attempt.txid}: ${errorMsg}`)
    }

    return result
  }

  /**
   * Check if transaction has correct output to treasury
   */
  private validateAmount(
    tx: KaspaTransaction,
    treasuryAddress: string,
    expectedAmount: bigint
  ): boolean {
    // Find output to treasury address with exact amount
    for (const output of tx.outputs) {
      // Check if address matches (address field or derived from scriptPublicKey)
      const outputAddress = output.address?.toLowerCase()
      const treasury = treasuryAddress.toLowerCase()

      if (outputAddress === treasury && output.value === expectedAmount) {
        return true
      }
    }
    return false
  }
}

/**
 * Standalone validation function for testing
 */
export function validatePayloadOnly(
  payloadHex: string,
  saleId: string,
  powDifficulty: number
): { valid: boolean; reason?: string; buyerAddrHash?: string } {
  try {
    const payload = decodePayload(payloadHex)

    if (payload.magic !== MAGIC) {
      return { valid: false, reason: `Invalid magic: ${payload.magic}` }
    }

    if (payload.version !== PAYLOAD_VERSION) {
      return { valid: false, reason: `Unsupported version: ${payload.version}` }
    }

    if (payload.saleId !== saleId) {
      return { valid: false, reason: `Sale ID mismatch` }
    }

    const powValid = verifyPow(
      {
        saleId,
        buyerAddrHash: payload.buyerAddrHash,
        difficulty: powDifficulty,
      },
      payload.powNonce
    )

    if (!powValid) {
      return { valid: false, reason: `PoW failed` }
    }

    return { valid: true, buyerAddrHash: payload.buyerAddrHash }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error'
    return { valid: false, reason }
  }
}
