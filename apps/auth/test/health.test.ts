import { describe, expect, it } from 'bun:test'
import { app } from '../src/index.ts'

describe('auth health', () => {
  it('GET /health/live is 200 and does not touch the database', async () => {
    const res = await app.handle(new Request('http://localhost/health/live'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'auth' })
  })

  it('GET /health/ready reports DB reachability without throwing', async () => {
    // 200 when auth_db is reachable (local `make dev`), 503 when it is not
    // (CI has no Postgres) — either is a correct answer, a 500 is not.
    const res = await app.handle(new Request('http://localhost/health/ready'))
    expect([200, 503]).toContain(res.status)
    const body = (await res.json()) as { status: string; service: string }
    expect(body.service).toBe('auth')
    expect(['ok', 'degraded']).toContain(body.status)
  })
})
