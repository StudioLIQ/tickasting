import { z } from 'zod'

export const createSaleSchema = z.object({
  network: z.enum(['mainnet', 'testnet']).default('testnet'),
  treasuryAddress: z.string().min(1),
  ticketPriceSompi: z.string().regex(/^\d+$/, 'Must be a valid sompi amount'),
  supplyTotal: z.number().int().positive(),
  maxPerAddress: z.number().int().positive().optional(),
  powDifficulty: z.number().int().min(0).max(32).default(18),
  finalityDepth: z.number().int().min(1).max(100).default(30),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
})

export type CreateSaleInput = z.infer<typeof createSaleSchema>
