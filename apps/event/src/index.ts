import { openapi } from '@elysiajs/openapi'
import { HealthResponse } from '@eventide/shared/models'
import { sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { env } from './env.ts'
import { db } from './lib/db.ts'
import { event } from './modules/event/index.ts'

const SERVICE = 'event'

/**
 * App root — one unbroken method chain, exports `type App` for Eden Treaty.
 * Never split this chain: a break silently degrades the SPA's types to `any`.
 */
export const app = new Elysia()
  .use(openapi({ path: '/swagger' }))
  .model({ Health: HealthResponse })
  // Liveness: process is up. MUST NOT touch the database (CLAUDE.md hard rule) —
  // a DB check here turns a 5s RDS blip into every pod restarting at once.
  .get('/health/live', () => ({ status: 'ok' as const, service: SERVICE }), {
    response: 'Health',
    detail: { summary: 'Liveness probe', tags: ['health'] },
  })
  // Readiness: event_db is reachable.
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
  .use(event)

export type App = typeof app

// Only bind a port when run as the entrypoint — tests import `app` and drive it
// with `app.handle()`, which needs no listener.
if (import.meta.main) {
  app.listen(env.PORT)
  console.log(`[${SERVICE}] listening on :${env.PORT}`)

  // Graceful shutdown — without this, every rolling update drops in-flight
  // requests and waits out the full grace period (CLAUDE.md / §12.1).
  const shutdown = () => {
    console.log(`[${SERVICE}] SIGTERM/SIGINT — stopping`)
    app.stop()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
