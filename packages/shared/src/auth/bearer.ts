import { Elysia } from 'elysia'
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose'

/**
 * Shared bearer-JWT verification for `event` and `registration` (SYSTEM-DESIGN §5.1).
 *
 * Verification is entirely local: `jose` fetches auth's public keys from its
 * JWKS endpoint and caches them, so there is no per-request hop to `auth` and no
 * database call. These services hold only a public key and cannot mint a token.
 */

export interface BearerAuthConfig {
  /** auth's JWKS URL, e.g. `http://auth.eventide.svc.cluster.local/api/auth/jwks`. */
  jwksUrl: string
  /** Expected `iss` claim — auth's `BETTER_AUTH_URL`. */
  issuer: string
  /** Expected `aud` claim — auth's `BETTER_AUTH_URL` (the JWT plugin default). */
  audience: string
}

export interface AuthUser {
  /** better-auth `user.id` — `text`, not a uuid (CLAUDE.md). */
  id: string
  email: string
}

// One remote key set per URL for the life of the process. `jose` refetches
// automatically when it sees a `kid` it doesn't have (i.e. after key rotation).
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwksFor(url: string) {
  const cached = jwksCache.get(url)
  if (cached) return cached
  const set = createRemoteJWKSet(new URL(url))
  jwksCache.set(url, set)
  return set
}

function userFromPayload(payload: JWTPayload): AuthUser | null {
  const id = typeof payload.sub === 'string' ? payload.sub : null
  const email = typeof payload.email === 'string' ? payload.email : null
  return id && email ? { id, email } : null
}

/**
 * Elysia plugin exposing an `auth` macro. Opt a route in with `{ auth: true }`
 * and its handler receives a verified `user: AuthUser` on context; an invalid or
 * missing token short-circuits with 401 before the handler runs.
 */
export function bearerAuth(config: BearerAuthConfig) {
  return new Elysia({ name: 'eventide-bearer-auth' }).macro({
    auth: {
      async resolve({ status, request }) {
        const header = request.headers.get('authorization')
        if (!header?.startsWith('Bearer ')) {
          return status(401, { error: 'unauthorized', message: 'missing bearer token' })
        }
        try {
          const { payload } = await jwtVerify(header.slice(7), jwksFor(config.jwksUrl), {
            issuer: config.issuer,
            audience: config.audience,
          })
          const user = userFromPayload(payload)
          if (!user) {
            return status(401, { error: 'unauthorized', message: 'token missing sub/email' })
          }
          return { user }
        } catch {
          return status(401, { error: 'unauthorized', message: 'invalid or expired token' })
        }
      },
    },
  })
}
