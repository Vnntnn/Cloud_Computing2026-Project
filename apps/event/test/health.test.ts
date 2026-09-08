import { describe, expect, it } from 'bun:test'
import { app } from '../src/index.ts'

describe('event health', () => {
  it('GET /health/live is 200 and does not touch the database', async () => {
    const res = await app.handle(new Request('http://localhost/health/live'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'event' })
  })

  it('GET /health/ready reports DB reachability without throwing', async () => {
    // 200 when event_db is reachable (local `make dev`), 503 when it is not
    // (CI has no Postgres) — either is correct, a 500 is not.
    const res = await app.handle(new Request('http://localhost/health/ready'))
    expect([200, 503]).toContain(res.status)
    const body = (await res.json()) as { status: string; service: string }
    expect(body.service).toBe('event')
    expect(['ok', 'degraded']).toContain(body.status)
  })
})

describe('event auth guard', () => {
  it('POST /api/events without a bearer token is 401', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'x',
          startsAt: '2026-10-01T18:00:00Z',
          endsAt: '2026-10-01T20:00:00Z',
          salesStartAt: '2026-09-01T00:00:00Z',
          salesEndAt: '2026-10-01T17:00:00Z',
          capacity: 10,
        }),
      }),
    )
    expect(res.status).toBe(401)
  })
})
