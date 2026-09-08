import { openapi } from '@elysiajs/openapi'
import { HealthResponse } from '@eventide/shared/models'
import { sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { env } from './env.ts'
import { db } from './lib/db.ts'
import { payment } from './modules/payment/index.ts'

const SERVICE = 'payment'
export const app = new Elysia()
  .use(openapi({ path: '/swagger' }))
  .model({ Health: HealthResponse })
  .get('/health/live', () => ({ status: 'ok' as const, service: SERVICE }), { response: 'Health' })
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
    { response: { 200: 'Health', 503: 'Health' } },
  )
  .get('/', () => ({ service: SERVICE, version: '0.0.0' }))
  .use(payment)

export type App = typeof app
if (import.meta.main) {
  app.listen(env.PORT)
  const shutdown = () => {
    app.stop()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
