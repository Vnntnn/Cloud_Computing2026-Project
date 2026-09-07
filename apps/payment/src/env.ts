import { defineEnv } from '@eventide/shared/env'
import { z } from 'zod'

export const env = defineEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3003),
    DATABASE_URL: z
      .string()
      .default('postgres://payment_svc:payment_svc@localhost:5432/payment_db'),
    REGISTRATION_SERVICE_URL: z.url().default('http://localhost:3002'),
    AUTH_JWKS_URL: z.url().default('http://localhost:3000/api/auth/jwks'),
    AUTH_BASE_URL: z.url().default('http://localhost:3000'),
    INTERNAL_SERVICE_TOKEN: z.string().min(32).default('dev-only-internal-service-token-000000'),
  }),
)

if (env.NODE_ENV === 'production') {
  const required = [
    'DATABASE_URL',
    'REGISTRATION_SERVICE_URL',
    'AUTH_JWKS_URL',
    'AUTH_BASE_URL',
    'INTERNAL_SERVICE_TOKEN',
  ] as const
  const missing = required.filter((name) => !process.env[name])
  if (missing.length) throw new Error(`payment: missing required env: ${missing.join(', ')}`)
}
