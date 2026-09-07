import { describe, expect, it } from 'bun:test'
import { app } from '../src/index.ts'

describe('payment health', () => {
  it('keeps liveness independent from the database', async () => {
    const response = await app.handle(new Request('http://localhost/health/live'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', service: 'payment' })
  })

  it('requires authentication for mock checkout', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/payments/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'test-key' },
        body: JSON.stringify({ orderId: '00000000-0000-4000-8000-000000000000' }),
      }),
    )
    expect(response.status).toBe(401)
  })
})
