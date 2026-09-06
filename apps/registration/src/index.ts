import { openapi } from '@elysiajs/openapi'
import { HealthResponse } from '@eventide/shared/models'
import { Elysia } from 'elysia'
import { env } from './env.ts'
import { registration } from './modules/registration/index.ts'

const SERVICE = 'registration'

/**
 * App root — one unbroken method chain, exports `type App` for Eden Treaty.
 */
export const app = new Elysia()
  .use(openapi({ path: '/swagger' }))
  .model({ Health: HealthResponse })
  // Liveness: MUST NOT touch the database (CLAUDE.md hard rule).
  .get('/health/live', () => ({ status: 'ok' as const, service: SERVICE }), {
    response: 'Health',
    detail: { summary: 'Liveness probe', tags: ['health'] },
  })
  // TODO(week2): real `SELECT 1` against the @eventide/db pool.
  .get('/health/ready', () => ({ status: 'ok' as const, service: SERVICE }), {
    response: 'Health',
    detail: { summary: 'Readiness probe', tags: ['health'] },
  })
  .get('/', () => ({ service: SERVICE, version: '0.0.0' }))
  .use(registration)

export type App = typeof app

// Only bind a port when run as the entrypoint — tests drive `app.handle()`.
if (import.meta.main) {
  app.listen(env.PORT)
  console.log(`[${SERVICE}] listening on :${env.PORT}`)

  const shutdown = () => {
    console.log(`[${SERVICE}] SIGTERM/SIGINT — stopping`)
    app.stop()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
