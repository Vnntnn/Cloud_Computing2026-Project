import { z } from 'zod'

export const eventsSearchSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  province: z.string().optional(),
  page: z.coerce.number().int().positive().default(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).catch(20),
})
