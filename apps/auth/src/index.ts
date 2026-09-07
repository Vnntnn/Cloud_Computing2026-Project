import { openapi } from '@elysiajs/openapi'
import { HealthResponse } from '@eventide/shared/models'
import { sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { env } from './env.ts'
import { auth } from './lib/auth.ts'
import { db } from './lib/db.ts'
import { users } from './modules/user/index.ts'

const SERVICE = 'auth'

/**
 * App root — one unbroken method chain, exports `type App` for Eden Treaty.
 * (The SPA authenticates via better-auth's own client, not Eden — but the chain
 * stays intact for consistency with the other services.)
 */
export const app = new Elysia()
  .use(openapi({ path: '/swagger' }))
  .model({ Health: HealthResponse })
  // Liveness: process is up. MUST NOT touch the database (CLAUDE.md hard rule).
  .get('/health/live', () => ({ status: 'ok' as const, service: SERVICE }), {
    response: 'Health',
    detail: { summary: 'Liveness probe', tags: ['health'] },
  })
  // Readiness: auth_db is reachable.
  .get(
    '/health/ready',
    async ({ status }) => {
      try {
        await db.execute(sql`select 1`)
        return { status: 'ok' as const, service: SERVICE }
      } catch {
        return status(503, { status: 'degraded' as const, service: SERVICE })
      }
    },
    {
      response: { 200: 'Health', 503: 'Health' },
      detail: { summary: 'Readiness probe', tags: ['health'] },
    },
  )
  .get('/', () => ({ service: SERVICE, version: '0.0.0' }))
  // better-auth owns everything under /api/auth — sign-up/in/out, get-session,
  // GET /api/auth/token (JWT), GET /api/auth/jwks (public keys). SYSTEM-DESIGN §3.1.
  // `.all` + delegate rather than `.mount` so the chain and the routes above
  // stay unambiguous.
  .all('/api/auth/*', ({ request }) => auth.handler(request))
  .all('/api/auth', ({ request }) => auth.handler(request))
  .use(users)

export type App = typeof app

// Only bind a port when run as the entrypoint — tests drive `app.handle()`.
if (import.meta.main) {
  app.listen(env.PORT)
  console.log(`[${SERVICE}] listening on :${env.PORT}`)

  // Graceful shutdown (CLAUDE.md / §12.1) — without this, rolling updates drop
  // in-flight requests and wait out the full grace period.
  const shutdown = () => {
    console.log(`[${SERVICE}] SIGTERM/SIGINT — stopping`)
    app.stop()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
