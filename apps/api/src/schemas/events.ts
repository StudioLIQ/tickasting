import { z } from 'zod'

export const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  venue: z.string().max(200).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
})

export type CreateEventInput = z.infer<typeof createEventSchema>
