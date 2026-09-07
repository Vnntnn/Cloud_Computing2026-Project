import { defineEnv } from '@eventide/shared/env'
import { z } from 'zod'

/**
 * Boot-time env validation (Zod is confined to this path — CLAUDE.md).
 *
 * On EKS `DATABASE_URL` arrives in the `eventide-registration` k8s Secret, built
 * by `scripts/deploy.sh` from Secrets Manager (SYSTEM-DESIGN §5.2). The URLs are
 * plain config — in-cluster they are Service DNS names. Locally the defaults
 * match `make dev` (auth :3000, event :3001, registration :3002).
 */
export const env = defineEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3002),

    // registration_db — owned by registration_svc, no grants on the other databases.
    DATABASE_URL: z
      .string()
      .default('postgres://registration_svc:registration_svc@localhost:5432/registration_db'),

    // event's in-cluster base URL — registration calls it once at booking time
    // for the event title + capacity (SYSTEM-DESIGN §4.3, §4.4).
    // In-cluster: http://event.eventide.svc.cluster.local
    EVENT_SERVICE_URL: z.url().default('http://localhost:3001'),

    // auth's JWKS endpoint + expected iss/aud — local JWT verification (§5.1).
    AUTH_JWKS_URL: z.url().default('http://localhost:3000/api/auth/jwks'),
    AUTH_BASE_URL: z.url().default('http://localhost:3000'),
  }),
)

// SYSTEM-DESIGN §5.2 — fail loudly at boot in a deployed environment rather than
// silently use a localhost default.
if (env.NODE_ENV === 'production') {
  const missing = (
    ['DATABASE_URL', 'EVENT_SERVICE_URL', 'AUTH_JWKS_URL', 'AUTH_BASE_URL'] as const
  ).filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`registration: missing required env in production: ${missing.join(', ')}`)
  }
}
