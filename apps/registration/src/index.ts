import { openapi } from '@elysiajs/openapi'
import { HealthResponse } from '@eventide/shared/models'
import { sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { env } from './env.ts'
import { db } from './lib/db.ts'
import { registration } from './modules/registration/index.ts'

const SERVICE = 'registration'

/**
 * App root — one unbroken method chain, exports `type App` for Eden Treaty.
 * Never split this chain: a break silently degrades the SPA's types to `any`.
 */
export const app = new Elysia()
  .use(openapi({ path: '/swagger' }))
  .model({ Health: HealthResponse })
  // Liveness: process is up. MUST NOT touch the database (CLAUDE.md hard rule).
  .get('/health/live', () => ({ status: 'ok' as const, service: SERVICE }), {
    response: 'Health',
    detail: { summary: 'Liveness probe', tags: ['health'] },
  })
  // Readiness: registration_db is reachable.
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
  .use(registration)

export type App = typeof app

// Only bind a port when run as the entrypoint — tests drive `app.handle()`.
if (import.meta.main) {
  app.listen(env.PORT)
  console.log(`[${SERVICE}] listening on :${env.PORT}`)

  // Graceful shutdown (CLAUDE.md / §12.1).
  const shutdown = () => {
    console.log(`[${SERVICE}] SIGTERM/SIGINT — stopping`)
    app.stop()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
