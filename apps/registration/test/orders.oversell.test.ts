import { beforeEach, describe, expect, it } from 'bun:test'
import { ticketInventory } from '@eventide/db/registration'
import { eq } from 'drizzle-orm'
import { app } from '../src/index.ts'
import { db } from '../src/lib/db.ts'
import {
  authHeader,
  checkoutSummary,
  readJson,
  resetRegistrationDb,
  stubEvent,
  ticketType,
} from './helpers.ts'

const order = async (token: string, eventId: string, ticketTypeId: string, quantity = 1) =>
  app.handle(
    new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: {
        authorization: token,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ eventId, items: [{ ticketTypeId, quantity }] }),
    }),
  )

describe('orders — oversell protection', () => {
  beforeEach(resetRegistrationDb)

  it('never reserves more than total_quota under concurrent load', async () => {
    const QUOTA = 5
    const tt = ticketType({ quota: QUOTA, maxPerOrder: QUOTA, price: '100.00' })
    const summary = stubEvent(checkoutSummary({ ticketTypes: [tt] }))
    const token = await authHeader({ id: 'buyer-load' })

    const results = await Promise.all(
      Array.from({ length: QUOTA + 6 }, () => order(token, summary.id, tt.id)),
    )
    const codes = results.map((r) => r.status)

    expect(codes.filter((c) => c === 200)).toHaveLength(QUOTA)
    expect(codes.filter((c) => c === 409)).toHaveLength(6)

    const [inv] = await db
      .select()
      .from(ticketInventory)
      .where(eq(ticketInventory.ticketTypeId, tt.id))
    expect(inv?.reservedCount).toBe(QUOTA)
    expect(inv?.soldCount).toBe(0)
  })

  it('rejects a single order that exceeds remaining inventory', async () => {
    const tt = ticketType({ quota: 3, maxPerOrder: 10, price: '100.00' })
    const summary = stubEvent(checkoutSummary({ ticketTypes: [tt] }))
    const token = await authHeader({ id: 'buyer-greedy' })

    const ok = await order(token, summary.id, tt.id, 3)
    expect(ok.status).toBe(200)

    const tooMany = await order(token, summary.id, tt.id, 1)
    expect(tooMany.status).toBe(409)
    expect((await readJson<{ error: string }>(tooMany)).error).toBe('capacity_full')
  })
})
