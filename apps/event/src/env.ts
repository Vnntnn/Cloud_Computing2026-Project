import { defineEnv } from '@eventide/shared/env'
import { z } from 'zod'

/**
 * Boot-time env validation (Zod is confined to this path — CLAUDE.md).
 *
 * On EKS `DATABASE_URL` (+ the S3 bucket name, week 3) is injected by External
 * Secrets Operator from Secrets Manager `eventide/event` (SYSTEM-DESIGN §5.2).
 * The auth URLs are plain config — in-cluster the JWKS URL is the `auth`
 * Service DNS name. Locally the defaults match `make dev`.
 */
export const env = defineEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3001),

    // event_db — owned by event_svc, no grants on the other databases.
    DATABASE_URL: z.string().default('postgres://event_svc:event_svc@localhost:5432/event_db'),

    // auth's JWKS endpoint — public keys for local JWT verification (§5.1).
    // In-cluster: http://auth.eventide.svc.cluster.local/api/auth/jwks
    AUTH_JWKS_URL: z.url().default('http://localhost:3000/api/auth/jwks'),
    // Expected `iss` / `aud` on the JWT — auth's BETTER_AUTH_URL.
    AUTH_BASE_URL: z.url().default('http://localhost:3000'),

    // S3 cover-image uploads (§4.2, §12). Unset → the cover-upload route is
    // disabled and events simply have no image. AWS credentials come from the
    // standard env chain (AWS_ACCESS_KEY_ID / _SECRET / _SESSION_TOKEN) — the
    // one place the app touches AWS, injected into the Secret by deploy.sh
    // because IRSA is unavailable (§5.3).
    S3_BUCKET_NAME: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
  }),
)

// SYSTEM-DESIGN §5.2 — a missing injected value must fail loudly at boot in a
// deployed environment, not silently use the localhost default.
if (env.NODE_ENV === 'production') {
  const missing = (['DATABASE_URL', 'AUTH_JWKS_URL', 'AUTH_BASE_URL'] as const).filter(
    (k) => !process.env[k],
  )
  if (missing.length > 0) {
    throw new Error(`event: missing required env in production: ${missing.join(', ')}`)
  }
}
