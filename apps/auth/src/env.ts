import { defineEnv } from '@eventide/shared/env'
import { z } from 'zod'

export const env = defineEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    // TODO(week2): all required once better-auth is mounted.
    //   DATABASE_URL          — auth_db
    //   BETTER_AUTH_SECRET    — key-encryption key for the JWKS private keys
    //   BETTER_AUTH_URL       — public base URL
    //   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
    DATABASE_URL: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_URL: z.url().optional(),
  }),
)
