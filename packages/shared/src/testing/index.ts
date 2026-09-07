/**
 * Test-only helpers (imported from `@eventide/shared/testing`).
 *
 * `installAuthFixture()` stands up a throwaway JWKS endpoint signed with a
 * generated key and points `AUTH_JWKS_URL` at it, so a service's real
 * `bearerAuth` guard (createRemoteJWKSet + jwtVerify) runs unchanged in a
 * component test. Call it from a bun `test.preload` script — before any test
 * file imports the service `app`, so `env.ts` reads the fixture URL.
 */
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose'

type Role = 'attendee' | 'organizer' | 'admin'
type Approval = 'NOT_APPLIED' | 'PENDING' | 'APPROVED' | 'REJECTED'

export interface TestUser {
  id: string
  email?: string
  role?: Role
  organizerApprovalStatus?: Approval
}

let state: { privateKey: CryptoKey; issuer: string; stop: () => void } | null = null

/** Start the JWKS fixture and set AUTH_JWKS_URL. Idempotent within a process. */
export async function installAuthFixture(issuer = 'http://localhost:3000'): Promise<void> {
  if (state) return
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' }
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname.endsWith('/jwks')
        ? Response.json({ keys: [jwk] })
        : new Response('not found', { status: 404 }),
  })
  process.env.AUTH_JWKS_URL = `http://localhost:${server.port}/api/auth/jwks`
  state = { privateKey, issuer, stop: () => server.stop(true) }
}

/** Mint a bearer token the fixture's key set will verify. */
export async function mintToken(u: TestUser): Promise<string> {
  if (!state) throw new Error('installAuthFixture() must run first (add it to test.preload)')
  const claims: JWTPayload = {
    email: u.email ?? `${u.id}@test.eventide`,
    role: u.role ?? 'attendee',
    organizerApprovalStatus: u.organizerApprovalStatus ?? 'NOT_APPLIED',
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
    .setSubject(u.id)
    .setIssuer(state.issuer)
    .setAudience(state.issuer)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(state.privateKey)
}

/** `Authorization` header value for a test user. */
export async function authHeader(u: TestUser): Promise<string> {
  return `Bearer ${await mintToken(u)}`
}

/** Read a JSON response body with a caller-supplied shape (test convenience). */
export async function readJson<T = Record<string, unknown>>(
  res: Response | Promise<Response>,
): Promise<T> {
  return (await res).json() as Promise<T>
}

/**
 * Minimal controllable HTTP fixture for stubbing an in-cluster peer service.
 * `route(path, handler)` matches by URL-path regex; unmatched paths 404.
 */
export function fakeService(): {
  url: string
  route: (
    pattern: RegExp,
    handler: (match: RegExpMatchArray, req: Request) => Response | Promise<Response>,
  ) => void
  reset: () => void
  stop: () => void
} {
  const routes: Array<
    [RegExp, (m: RegExpMatchArray, req: Request) => Response | Promise<Response>]
  > = []
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname
      for (const [pattern, handler] of routes) {
        const m = path.match(pattern)
        if (m) return handler(m, req)
      }
      return new Response(`no fixture route for ${path}`, { status: 404 })
    },
  })
  return {
    url: `http://localhost:${server.port}`,
    route: (pattern, handler) => routes.push([pattern, handler]),
    reset: () => routes.splice(0, routes.length),
    stop: () => server.stop(true),
  }
}
