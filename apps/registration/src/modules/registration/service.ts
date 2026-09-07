import {
  checkIns,
  idempotencyKeys,
  orderAuditLogs,
  orderItems,
  orders,
  ticketInventory,
  tickets,
} from '@eventide/db/registration'
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm'
import { jwtVerify, SignJWT } from 'jose'
import { env } from '../../env.ts'
import { db } from '../../lib/db.ts'
import { fetchCheckoutSummary } from '../../lib/event-client.ts'
import type { CreateOrder } from './model.ts'

export class CapacityFull extends Error {}
export class InvalidOrder extends Error {}
export class OrderNotFound extends Error {}
export class Forbidden extends Error {}

const key = new TextEncoder().encode(env.TICKET_SIGNING_SECRET)
const cents = (value: string) => Math.round(Number(value) * 100)
const money = (value: number) => (value / 100).toFixed(2)
const hash = (value: string) => new Bun.CryptoHasher('sha256').update(value).digest('hex')

function formatOrder(row: typeof orders.$inferSelect, items: (typeof orderItems.$inferSelect)[]) {
  return {
    ...row,
    currency: 'THB' as const,
    refundPercent: row.refundPercent,
    expiresAt: row.expiresAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: undefined,
    items: items.map(({ orderId: _orderId, ...item }) => item),
  }
}

async function dto(row: typeof orders.$inferSelect) {
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, row.id))
    .orderBy(asc(orderItems.id))
  return formatOrder(row, items)
}

async function signTicket(row: typeof tickets.$inferSelect) {
  return new SignJWT({
    eventId: row.eventId,
    ownerId: row.userId,
    issuedAt: row.issuedAt.toISOString(),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: env.TICKET_SIGNING_KEY_ID })
    .setSubject(row.id)
    .sign(key)
}

export abstract class RegistrationService {
  static async create(input: CreateOrder, userId: string, idempotencyKey: string) {
    const requestHash = hash(JSON.stringify(input))
    const [replay] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, 'order'), eq(idempotencyKeys.key, idempotencyKey)))
      .limit(1)
    if (replay) {
      if (replay.userId !== userId || replay.requestHash !== requestHash)
        throw new InvalidOrder('idempotency key reused with another request')
      const [existing] = replay.resourceId
        ? await db.select().from(orders).where(eq(orders.id, replay.resourceId)).limit(1)
        : []
      if (existing) return dto(existing)
    }

    const event = await fetchCheckoutSummary(input.eventId)
    const now = new Date()
    if (
      event.status !== 'PUBLISHED' ||
      now < new Date(event.salesStartAt) ||
      now > new Date(event.salesEndAt)
    )
      throw new InvalidOrder('event is not on sale')
    const requested = new Map(input.items.map((item) => [item.ticketTypeId, item.quantity]))
    if (requested.size !== input.items.length) throw new InvalidOrder('duplicate ticket type')
    const selected = event.ticketTypes.filter((type) => requested.has(type.id))
    if (
      selected.length !== input.items.length ||
      selected.some((type) => requested.get(type.id)! > type.maxPerOrder)
    )
      throw new InvalidOrder('invalid ticket selection')
    for (const type of selected) {
      const start = type.salesStartAt ? new Date(type.salesStartAt) : new Date(event.salesStartAt)
      const end = type.salesEndAt ? new Date(type.salesEndAt) : new Date(event.salesEndAt)
      if (now < start || now > end) throw new InvalidOrder(`${type.name} is not on sale`)
    }
    const totalCents = selected.reduce(
      (sum, type) => sum + cents(type.price) * requested.get(type.id)!,
      0,
    )

    return db.transaction(async (tx) => {
      for (const type of [...selected].sort((a, b) => a.id.localeCompare(b.id))) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${type.id}, 0))`)
        await tx
          .insert(ticketInventory)
          .values({ ticketTypeId: type.id, eventId: event.id, totalQuota: type.quota })
          .onConflictDoNothing()
        const [inventory] = await tx
          .select()
          .from(ticketInventory)
          .where(eq(ticketInventory.ticketTypeId, type.id))
          .limit(1)
        const quantity = requested.get(type.id)!
        if (
          !inventory ||
          inventory.totalQuota !== type.quota ||
          inventory.reservedCount + inventory.soldCount + quantity > inventory.totalQuota
        )
          throw new CapacityFull()
        await tx
          .update(ticketInventory)
          .set({
            reservedCount: sql`${ticketInventory.reservedCount} + ${quantity}`,
            updatedAt: now,
          })
          .where(eq(ticketInventory.ticketTypeId, type.id))
      }
      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          eventId: event.id,
          eventTitle: event.title,
          subtotal: money(totalCents),
          total: money(totalCents),
          refundPercent: event.refundPercent,
          expiresAt: new Date(now.getTime() + 8 * 60_000),
        })
        .returning()
      await tx.insert(orderItems).values(
        selected.map((type) => ({
          orderId: order!.id,
          ticketTypeId: type.id,
          ticketTypeName: type.name,
          unitPrice: type.price,
          quantity: requested.get(type.id)!,
          lineTotal: money(cents(type.price) * requested.get(type.id)!),
        })),
      )
      await tx
        .insert(orderAuditLogs)
        .values({ orderId: order!.id, actorId: userId, action: 'RESERVED' })
      await tx.insert(idempotencyKeys).values({
        scope: 'order',
        key: idempotencyKey,
        userId,
        requestHash,
        resourceId: order!.id,
        responseStatus: 200,
      })
      const insertedItems = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order!.id))
        .orderBy(asc(orderItems.id))
      return formatOrder(order!, insertedItems)
    })
  }

  static async mine(userId: string) {
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
    return Promise.all(rows.map(dto))
  }

  static async get(id: string, userId?: string) {
    const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1)
    if (!row || (userId && row.userId !== userId)) return null
    return dto(row)
  }

  static async paymentOrder(id: string) {
    const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1)
    if (!row) throw new OrderNotFound()
    return {
      id: row.id,
      userId: row.userId,
      status: row.status,
      total: row.total,
      currency: 'THB' as const,
      refundPercent: row.refundPercent,
      expiresAt: row.expiresAt.toISOString(),
    }
  }

  static async confirm(id: string, paymentId: string) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`)
      const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1)
      if (!order) throw new OrderNotFound()
      if (order.status === 'CONFIRMED') {
        const existingItems = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
          .orderBy(asc(orderItems.id))
        return formatOrder(order, existingItems)
      }
      if (order.status !== 'PENDING' && order.status !== 'PENDING_VERIFICATION')
        throw new InvalidOrder(`cannot confirm ${order.status}`)
      if (order.expiresAt < new Date()) throw new InvalidOrder('order expired')
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id))
      for (const item of items) {
        await tx
          .update(ticketInventory)
          .set({
            reservedCount: sql`${ticketInventory.reservedCount} - ${item.quantity}`,
            soldCount: sql`${ticketInventory.soldCount} + ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(ticketInventory.ticketTypeId, item.ticketTypeId))
        await tx.insert(tickets).values(
          Array.from({ length: item.quantity }, () => ({
            orderId: id,
            orderItemId: item.id,
            ticketTypeId: item.ticketTypeId,
            eventId: order.eventId,
            userId: order.userId,
            eventTitle: order.eventTitle,
            ticketTypeName: item.ticketTypeName,
          })),
        )
      }
      const [confirmed] = await tx
        .update(orders)
        .set({ status: 'CONFIRMED', confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(orders.id, id))
        .returning()
      await tx
        .insert(orderAuditLogs)
        .values({ orderId: id, action: 'CONFIRMED', details: JSON.stringify({ paymentId }) })
      return formatOrder(confirmed!, items)
    })
  }

  static async markPendingVerification(id: string) {
    await db
      .update(orders)
      .set({ status: 'PENDING_VERIFICATION', updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.status, 'PENDING')))
  }

  static async refund(id: string) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`)
      const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1)
      if (!order) throw new OrderNotFound()
      if (order.status === 'REFUNDED') return
      if (order.status !== 'CONFIRMED') throw new InvalidOrder(`cannot refund ${order.status}`)
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id))
      for (const item of items) {
        await tx
          .update(ticketInventory)
          .set({
            soldCount: sql`${ticketInventory.soldCount} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(ticketInventory.ticketTypeId, item.ticketTypeId))
      }
      await tx.update(tickets).set({ status: 'REFUNDED' }).where(eq(tickets.orderId, id))
      await tx
        .update(orders)
        .set({ status: 'REFUNDED', updatedAt: new Date() })
        .where(eq(orders.id, id))
      await tx.insert(orderAuditLogs).values({ orderId: id, action: 'REFUNDED' })
    })
  }

  static async cancel(id: string, userId: string) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`)
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, id), eq(orders.userId, userId)))
        .limit(1)
      if (!order) throw new OrderNotFound()
      if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
        const existingItems = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
          .orderBy(asc(orderItems.id))
        return formatOrder(order, existingItems)
      }
      if (order.status !== 'PENDING') throw new InvalidOrder(`cannot cancel ${order.status}`)
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, id))
      for (const item of items)
        await tx
          .update(ticketInventory)
          .set({
            reservedCount: sql`${ticketInventory.reservedCount} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(ticketInventory.ticketTypeId, item.ticketTypeId))
      const [cancelled] = await tx
        .update(orders)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(orders.id, id))
        .returning()
      await tx.insert(orderAuditLogs).values({ orderId: id, actorId: userId, action: 'CANCELLED' })
      return formatOrder(cancelled!, items)
    })
  }

  static async expire() {
    const expired = await db
      .select({ id: orders.id, userId: orders.userId })
      .from(orders)
      .where(and(eq(orders.status, 'PENDING'), lt(orders.expiresAt, new Date())))
    for (const order of expired)
      await this.cancel(order.id, order.userId).then(async () => {
        await db.update(orders).set({ status: 'EXPIRED' }).where(eq(orders.id, order.id))
      })
    return expired.length
  }

  static async tickets(userId: string) {
    const rows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.userId, userId))
      .orderBy(desc(tickets.issuedAt))
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        userId: undefined,
        orderItemId: undefined,
        issuedAt: row.issuedAt.toISOString(),
        qrToken: await signTicket(row),
      })),
    )
  }

  static async ticket(id: string, userId: string) {
    const [row] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.userId, userId)))
      .limit(1)
    if (!row) return null
    return {
      ...row,
      userId: undefined,
      orderItemId: undefined,
      issuedAt: row.issuedAt.toISOString(),
      qrToken: await signTicket(row),
    }
  }

  static async checkIn(qrToken: string, expectedEventId: string, scannerId: string) {
    const payloadHash = hash(qrToken)
    let ticketId: string | null = null
    let eventId: string | null = null
    let result: typeof checkIns.$inferInsert.result = 'INVALID'
    try {
      const verified = await jwtVerify(qrToken, key, { algorithms: ['HS256'] })
      ticketId = verified.payload.sub ?? null
      eventId = typeof verified.payload.eventId === 'string' ? verified.payload.eventId : null
      if (eventId !== expectedEventId) result = 'WRONG_EVENT'
      else if (ticketId) {
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ticketId}, 0))`)
          const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId!)).limit(1)
          if (!ticket) result = 'INVALID'
          else if (ticket.status === 'USED') result = 'DUPLICATE'
          else if (ticket.status === 'CANCELLED') result = 'CANCELLED'
          else if (ticket.status === 'REFUNDED') result = 'REFUNDED'
          else {
            result = 'SUCCESS'
            await tx.update(tickets).set({ status: 'USED' }).where(eq(tickets.id, ticket.id))
          }
        })
      }
    } catch {
      result = 'INVALID'
    }
    const [record] = await db
      .insert(checkIns)
      .values({ ticketId, eventId, scannerId, result, payloadHash })
      .returning()
    return { ...record!, createdAt: record!.createdAt.toISOString() }
  }

  static async checkIns(eventId: string) {
    return db
      .select()
      .from(checkIns)
      .where(eq(checkIns.eventId, eventId))
      .orderBy(desc(checkIns.createdAt))
  }
}
