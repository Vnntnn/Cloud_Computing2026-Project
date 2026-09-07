import { beforeEach, describe, expect, it } from 'bun:test'
import { paymentAttempts, payments, refunds } from '@eventide/db/payment'
import { eq } from 'drizzle-orm'
import { app } from '../src/index.ts'
import { db } from '../src/lib/db.ts'
import {
  authHeader,
  readJson,
  resetPaymentDb,
  resetRegistrationStub,
  seedOrder,
  setPeerFailure,
} from './helpers.ts'

type PaymentBody = { id: string; status: string; amount: string }

const BUYER = 'buyer-1'

const checkout = (token: string, orderId: string, key = crypto.randomUUID()) =>
  app.handle(
    new Request('http://localhost/api/payments/checkout', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify({ orderId }),
    }),
  )

describe('payment — mock checkout', () => {
  beforeEach(async () => {
    resetRegistrationStub()
    await resetPaymentDb()
  })

  it('confirms the order and records exactly one payment + attempt', async () => {
    const token = await authHeader({ id: BUYER })
    const order = seedOrder({ userId: BUYER })

    const res = await checkout(token, order.id)
    expect(res.status).toBe(200)
    const body = await readJson<PaymentBody>(res)
    expect(body.status).toBe('SUCCEEDED')
    expect(body.amount).toBe('1000.00')

    expect(await db.select().from(payments).where(eq(payments.orderId, order.id))).toHaveLength(1)
    expect(await db.select().from(paymentAttempts)).toHaveLength(1)
  })

  it('is idempotent for a repeated Idempotency-Key', async () => {
    const token = await authHeader({ id: BUYER })
    const order = seedOrder({ userId: BUYER })
    const key = crypto.randomUUID()

    const [a, b] = await Promise.all([
      checkout(token, order.id, key),
      checkout(token, order.id, key),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect((await readJson<PaymentBody>(a)).id).toBe((await readJson<PaymentBody>(b)).id)

    expect(await db.select().from(payments)).toHaveLength(1)
    expect(await db.select().from(paymentAttempts)).toHaveLength(1)
  })

  it('rejects a checkout for another user’s order', async () => {
    const token = await authHeader({ id: 'not-the-buyer' })
    const order = seedOrder({ userId: BUYER })
    const res = await checkout(token, order.id)
    expect(res.status).toBe(403)
  })

  it('goes PENDING_VERIFICATION when the confirm call fails, then reconciles once', async () => {
    const token = await authHeader({ id: BUYER })
    const order = seedOrder({ userId: BUYER })
    setPeerFailure({ confirm: true })

    const res = await checkout(token, order.id)
    expect(res.status).toBe(200)
    expect((await readJson<PaymentBody>(res)).status).toBe('PENDING_VERIFICATION')
    const [pending] = await db.select().from(payments).where(eq(payments.orderId, order.id))
    expect(pending?.status).toBe('PENDING_VERIFICATION')

    setPeerFailure({ confirm: false })
    const admin = await authHeader({ id: 'admin-1', role: 'admin' })
    const rec = await app.handle(
      new Request(`http://localhost/api/payments/${pending!.id}/reconcile`, {
        method: 'POST',
        headers: { authorization: admin },
      }),
    )
    expect(rec.status).toBe(200)
    expect((await readJson<PaymentBody>(rec)).status).toBe('SUCCEEDED')

    expect(await db.select().from(payments).where(eq(payments.orderId, order.id))).toHaveLength(1)
    expect(await db.select().from(paymentAttempts)).toHaveLength(1)
  })

  it('refunds a confirmed order once and records a refund row', async () => {
    const token = await authHeader({ id: BUYER })
    const order = seedOrder({ userId: BUYER })
    await checkout(token, order.id) // order -> CONFIRMED, payment -> SUCCEEDED

    const first = await app.handle(
      new Request(`http://localhost/api/payments/order/${order.id}/refund`, {
        method: 'POST',
        headers: { authorization: token },
      }),
    )
    expect(first.status).toBe(200)
    expect((await readJson<PaymentBody>(first)).status).toBe('REFUNDED')

    const second = await app.handle(
      new Request(`http://localhost/api/payments/order/${order.id}/refund`, {
        method: 'POST',
        headers: { authorization: token },
      }),
    )
    expect(second.status).toBe(200) // idempotent — already REFUNDED

    expect(await db.select().from(refunds).where(eq(refunds.orderId, order.id))).toHaveLength(1)
  })
})
