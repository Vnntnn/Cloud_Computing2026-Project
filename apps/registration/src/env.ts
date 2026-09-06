import { defineEnv } from '@eventide/shared/env'
import { z } from 'zod'

export const env = defineEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    // TODO(week2): make required once @eventide/db is wired and ESO injects it.
    DATABASE_URL: z.string().optional(),
    // TODO(week3): in-cluster base URL of the event service for ticket enrichment.
    EVENT_SERVICE_URL: z.url().optional(),
  }),
)
