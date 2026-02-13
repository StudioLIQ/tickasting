import { z } from 'zod'

export const ticketTypeSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Z0-9_]+$/, 'Must be uppercase alphanumeric'),
  name: z.string().min(1).max(100),
  priceSompi: z.string().regex(/^\d+$/, 'Must be a valid sompi amount'),
  supply: z.number().int().positive(),
  metadataUri: z.string().optional(),
  perk: z.any().optional(),
  sortOrder: z.number().int().min(0).default(0),
})

export const updateTicketTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  priceSompi: z.string().regex(/^\d+$/, 'Must be a valid sompi amount').optional(),
  supply: z.number().int().positive().optional(),
  metadataUri: z.string().optional(),
  perk: z.any().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export const createSaleSchema = z.object({
  network: z.enum(['mainnet', 'testnet']).default('testnet'),
  treasuryAddress: z.string().min(1),
  ticketPriceSompi: z.string().regex(/^\d+$/, 'Must be a valid sompi amount'),
  supplyTotal: z.number().int().positive(),
  maxPerAddress: z.number().int().positive().optional(),
  powDifficulty: z.number().int().min(0).max(32).default(18),
  finalityDepth: z.number().int().min(1).max(100).default(30),
  fallbackEnabled: z.boolean().default(false),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  ticketTypes: z.array(ticketTypeSchema).optional(),
})

export type CreateSaleInput = z.infer<typeof createSaleSchema>
export type TicketTypeInput = z.infer<typeof ticketTypeSchema>
export type UpdateTicketTypeInput = z.infer<typeof updateTicketTypeSchema>
