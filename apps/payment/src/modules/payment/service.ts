import { paymentAttempts, payments, refunds } from '@eventide/db/payment'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../../lib/db.ts'
import {
  confirmOrder,
  getPaymentOrder,
  markPendingVerification,
  refundOrder,
} from '../../lib/registration-client.ts'

export class PaymentForbidden extends Error {}
export class PaymentInvalid extends Error {}
export class PaymentNotFound extends Error {}

type PaymentRow = typeof payments.$inferSelect
const dto = (row: PaymentRow) => ({
  ...row,
  userId: undefined,
  currency: 'THB' as const,
  provider: 'mock' as const,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export abstract class PaymentService {
  static async checkout(orderId: string, userId: string, idempotencyKey: string) {
    const order = await getPaymentOrder(orderId)
    if (order.userId !== userId) throw new PaymentForbidden()
    if (order.status === 'CONFIRMED') {
      const [existing] = await db
        .select()
        .from(payments)
        .where(eq(payments.orderId, orderId))
        .limit(1)
      if (existing) return dto(existing)
    }
    if (order.status !== 'PENDING' && order.status !== 'PENDING_VERIFICATION')
      throw new PaymentInvalid(`cannot pay ${order.status}`)
    if (new Date(order.expiresAt) < new Date()) throw new PaymentInvalid('order expired')

    const payment = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`)
      const [replay] = await tx
        .select({ payment: payments })
        .from(paymentAttempts)
        .innerJoin(payments, eq(paymentAttempts.paymentId, payments.id))
        .where(eq(paymentAttempts.idempotencyKey, idempotencyKey))
        .limit(1)
      if (replay) {
        if (replay.payment.orderId !== orderId || replay.payment.userId !== userId)
          throw new PaymentInvalid('idempotency key reused')
        return replay.payment
      }
      let [row] = await tx.select().from(payments).where(eq(payments.orderId, orderId)).limit(1)
      if (!row)
        [row] = await tx
          .insert(payments)
          .values({ orderId, userId, amount: order.total, currency: order.currency })
          .returning()
      await tx
        .insert(paymentAttempts)
        .values({ paymentId: row!.id, idempotencyKey, attemptNumber: 1, status: 'SUCCEEDED' })
      const [succeeded] = await tx
        .update(payments)
        .set({
          status: 'SUCCEEDED',
          providerReference: `mock_${crypto.randomUUID()}`,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, row!.id))
        .returning()
      return succeeded!
    })

    try {
      await confirmOrder(orderId, payment.id)
      return dto(payment)
    } catch {
      const [uncertain] = await db
        .update(payments)
        .set({ status: 'PENDING_VERIFICATION', updatedAt: new Date() })
        .where(eq(payments.id, payment.id))
        .returning()
      await markPendingVerification(orderId)
      return dto(uncertain!)
    }
  }

  static async forOrder(orderId: string, userId: string) {
    const [row] = await db.select().from(payments).where(eq(payments.orderId, orderId)).limit(1)
    if (!row || row.userId !== userId) throw new PaymentNotFound()
    return dto(row)
  }

  static async list(status?: PaymentRow['status']) {
    const query = db.select().from(payments)
    const rows = status
      ? await query.where(eq(payments.status, status)).orderBy(desc(payments.createdAt))
      : await query.orderBy(desc(payments.createdAt))
    return rows.map(dto)
  }

  static async reconcile(paymentId: string) {
    const [row] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
    if (!row) throw new PaymentNotFound()
    if (row.status === 'SUCCEEDED') return dto(row)
    if (row.status !== 'PENDING_VERIFICATION')
      throw new PaymentInvalid(`cannot reconcile ${row.status}`)
    await confirmOrder(row.orderId, row.id)
    const [updated] = await db
      .update(payments)
      .set({ status: 'SUCCEEDED', updatedAt: new Date() })
      .where(eq(payments.id, row.id))
      .returning()
    return dto(updated!)
  }

  static async refund(orderId: string, userId: string) {
    const order = await getPaymentOrder(orderId)
    if (order.userId !== userId) throw new PaymentForbidden()
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId)).limit(1)
    if (!payment) throw new PaymentNotFound()
    if (payment.status === 'REFUNDED') return dto(payment)
    if (payment.status !== 'SUCCEEDED' || order.status !== 'CONFIRMED')
      throw new PaymentInvalid('only confirmed orders can be refunded')

    const amount = ((Number(payment.amount) * order.refundPercent) / 100).toFixed(2)
    await db
      .insert(refunds)
      .values({
        paymentId: payment.id,
        orderId,
        amount,
        status: 'PROCESSING',
        reason: 'attendee cancellation',
      })
      .onConflictDoNothing()
    try {
      await refundOrder(orderId)
      await db
        .update(refunds)
        .set({ status: 'SUCCEEDED', completedAt: new Date() })
        .where(eq(refunds.orderId, orderId))
      const [updated] = await db
        .update(payments)
        .set({ status: 'REFUNDED', updatedAt: new Date() })
        .where(eq(payments.id, payment.id))
        .returning()
      if (!updated) throw new PaymentNotFound()
      return dto(updated)
    } catch (cause) {
      await db.update(refunds).set({ status: 'FAILED' }).where(eq(refunds.orderId, orderId))
      throw new PaymentInvalid('refund requires reconciliation', { cause })
    }
  }
}
