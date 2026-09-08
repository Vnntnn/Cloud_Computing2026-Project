import { beforeEach, describe, expect, it } from 'bun:test'
import { orderItems, orders, ticketInventory } from '@eventide/db/registration'
import { eq } from 'drizzle-orm'
import { app } from '../src/index.ts'
import { db } from '../src/lib/db.ts'
import { RegistrationService } from '../src/modules/registration/service.ts'
import {
  authHeader,
  checkoutSummary,
  readJson,
  resetRegistrationDb,
  stubEvent,
  ticketType,
} from './helpers.ts'

const post = (token: string, key: string, body: unknown) =>
  app.handle(
    new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
  )

describe('orders — idempotency', () => {
  beforeEach(resetRegistrationDb)

  it('a repeated Idempotency-Key produces exactly one order and one item set', async () => {
    const tt = ticketType({ quota: 50, maxPerOrder: 10 })
    const summary = stubEvent(checkoutSummary({ ticketTypes: [tt] }))
    const token = await authHeader({ id: 'buyer-idem' })
    const body = { eventId: summary.id, items: [{ ticketTypeId: tt.id, quantity: 2 }] }

    const responses = await Promise.all([
      post(token, 'key-1', body),
      post(token, 'key-1', body),
      post(token, 'key-1', body),
    ])
    for (const r of responses) expect(r.status).toBe(200)
    const ids = new Set(
      await Promise.all(responses.map(async (r) => (await readJson<{ id: string }>(r)).id)),
    )
    expect(ids.size).toBe(1)

    expect(await db.select().from(orders)).toHaveLength(1)
    expect(await db.select().from(orderItems)).toHaveLength(1)
    const [inv] = await db
      .select()
      .from(ticketInventory)
      .where(eq(ticketInventory.ticketTypeId, tt.id))
    expect(inv?.reservedCount).toBe(2)
  })

  it('the same key with a different body is rejected', async () => {
    const tt = ticketType({ quota: 50 })
    const summary = stubEvent(checkoutSummary({ ticketTypes: [tt] }))
    const token = await authHeader({ id: 'buyer-idem2' })

    const first = await post(token, 'key-2', {
      eventId: summary.id,
      items: [{ ticketTypeId: tt.id, quantity: 1 }],
    })
    expect(first.status).toBe(200)

    const reused = await post(token, 'key-2', {
      eventId: summary.id,
      items: [{ ticketTypeId: tt.id, quantity: 3 }],
    })
    expect(reused.status).toBe(409)
  })
})

describe('orders — hold expiry', () => {
  beforeEach(resetRegistrationDb)

  it('an expired PENDING hold releases its reserved inventory and becomes EXPIRED', async () => {
    const tt = ticketType({ quota: 10 })
    const summary = stubEvent(checkoutSummary({ ticketTypes: [tt] }))
    const token = await authHeader({ id: 'buyer-exp' })

    const res = await post(token, 'key-exp', {
      eventId: summary.id,
      items: [{ ticketTypeId: tt.id, quantity: 3 }],
    })
    const { id } = await readJson<{ id: string }>(res)

    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, id))
    expect(await RegistrationService.expire()).toBe(1)

    const [order] = await db.select().from(orders).where(eq(orders.id, id))
    expect(order?.status).toBe('EXPIRED')
    const [inv] = await db
      .select()
      .from(ticketInventory)
      .where(eq(ticketInventory.ticketTypeId, tt.id))
    expect(inv?.reservedCount).toBe(0)
  })

  it('a CONFIRMED order is never expired by the sweep', async () => {
    const tt = ticketType({ quota: 10 })
    const summary = stubEvent(checkoutSummary({ ticketTypes: [tt] }))
    const token = await authHeader({ id: 'buyer-confirmed' })

    const res = await post(token, 'key-confirmed', {
      eventId: summary.id,
      items: [{ ticketTypeId: tt.id, quantity: 1 }],
    })
    const { id } = await readJson<{ id: string }>(res)
    await RegistrationService.confirm(id, crypto.randomUUID())

    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, id))
    expect(await RegistrationService.expire()).toBe(0)

    const [order] = await db.select().from(orders).where(eq(orders.id, id))
    expect(order?.status).toBe('CONFIRMED')
    const [inv] = await db
      .select()
      .from(ticketInventory)
      .where(eq(ticketInventory.ticketTypeId, tt.id))
    expect(inv?.soldCount).toBe(1)
    expect(inv?.reservedCount).toBe(0)
  })
})

describe('orders — cumulative attendee limit', () => {
  beforeEach(resetRegistrationDb)

  it('counts active orders across idempotency keys without limiting another attendee', async () => {
    const tt = ticketType({ quota: 20, maxPerOrder: 3, maxPerUser: 4 })
    const summary = stubEvent(checkoutSummary({ ticketTypes: [tt] }))
    const firstBuyer = await authHeader({ id: 'buyer-limit' })

    expect(
      (
        await post(firstBuyer, 'limit-first', {
          eventId: summary.id,
          items: [{ ticketTypeId: tt.id, quantity: 3 }],
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await post(firstBuyer, 'limit-second', {
          eventId: summary.id,
          items: [{ ticketTypeId: tt.id, quantity: 2 }],
        })
      ).status,
    ).toBe(409)

    const otherBuyer = await authHeader({ id: 'buyer-limit-other' })
    expect(
      (
        await post(otherBuyer, 'limit-other', {
          eventId: summary.id,
          items: [{ ticketTypeId: tt.id, quantity: 2 }],
        })
      ).status,
    ).toBe(200)
  })
})
