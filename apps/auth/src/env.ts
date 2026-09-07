import { defineEnv } from '@eventide/shared/env'
import { z } from 'zod'

/**
 * Boot-time env validation (Zod is confined to this path — CLAUDE.md).
 *
 * On EKS every value below is delivered in the `eventide-auth` k8s Secret,
 * built by `scripts/deploy.sh` from Secrets Manager (SYSTEM-DESIGN §5.2).
 * Locally the defaults match `packages/db/scripts/bootstrap.ts` and `make dev` —
 * no `.env` needed until you add Google OAuth.
 */
export const env = defineEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),

    // auth_db — owned by auth_svc, no grants on the other databases.
    DATABASE_URL: z.string().default('postgres://auth_svc:auth_svc@localhost:5432/auth_db'),

    // Key-encryption key for the JWKS private keys stored in `auth_db` (AES-256-GCM).
    // The dev default is NOT a secret; deploy.sh injects a real one in every deployed env.
    BETTER_AUTH_SECRET: z.string().min(32).default('dev-only-insecure-better-auth-secret-0000000'),

    // Public base URL — the JWT issuer/audience and the OAuth redirect origin.
    BETTER_AUTH_URL: z.url().default('http://localhost:3000'),

    // Extra origins allowed to call /api/auth (CSRF check), comma-separated.
    // Deployed, the SPA is same-origin so BETTER_AUTH_URL covers it and this stays
    // empty; the auth `dev` script sets it to the Vite origin (localhost:5173).
    TRUSTED_ORIGINS: z.string().default(''),

    // Google OAuth — optional. Email/password works without it, which is what
    // lets the seed create users and keeps the demo resilient (SYSTEM-DESIGN §5.1.1).
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
  }),
)

// SYSTEM-DESIGN §5.2 — in a deployed environment a missing injected secret must
// fail loudly at boot, never silently fall back to the insecure dev default.
if (env.NODE_ENV === 'production') {
  const missing = (['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'] as const).filter(
    (k) => !process.env[k],
  )
  if (missing.length > 0) {
    throw new Error(
      `auth: missing required env in production (deploy.sh should inject these): ${missing.join(', ')}`,
    )
  }
}
