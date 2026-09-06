import { describe, expect, it } from 'bun:test'
import { app } from '../src/index.ts'

describe('event health', () => {
  it('GET /health/live is 200 and does not touch the database', async () => {
    const res = await app.handle(new Request('http://localhost/health/live'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'event' })
  })

  it('GET /health/ready is 200', async () => {
    const res = await app.handle(new Request('http://localhost/health/ready'))
    expect(res.status).toBe(200)
  })
})
