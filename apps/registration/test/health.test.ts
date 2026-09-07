import { describe, expect, it } from 'bun:test'
import { app } from '../src/index.ts'

describe('registration health', () => {
  it('GET /health/live is 200 and does not touch the database', async () => {
    const res = await app.handle(new Request('http://localhost/health/live'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'registration' })
  })

  it('GET /health/ready reports DB reachability without throwing', async () => {
    // 200 when registration_db is reachable (local `make dev`), 503 when not
    // (CI has no Postgres) — either is correct, a 500 is not.
    const res = await app.handle(new Request('http://localhost/health/ready'))
    expect([200, 503]).toContain(res.status)
    const body = (await res.json()) as { status: string; service: string }
    expect(body.service).toBe('registration')
    expect(['ok', 'degraded']).toContain(body.status)
  })
})

describe('registration auth guard', () => {
  it('POST /api/registrations without a bearer token is 401', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/registrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: '00000000-0000-4000-8000-000000000000' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/registrations/me without a bearer token is 401', async () => {
    const res = await app.handle(new Request('http://localhost/api/registrations/me'))
    expect(res.status).toBe(401)
  })
})
