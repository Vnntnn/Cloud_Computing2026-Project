import {
  categories,
  eventChangeLogs,
  eventImages,
  events,
  ticketTypes,
  venues,
} from '@eventide/db/event'
import { and, asc, count, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm'
import { db } from '../../lib/db.ts'
import { coverKeyFor, presignGet, presignPut, s3Enabled } from '../../lib/s3.ts'
import type { EventInput, EventShape, TicketTypeInput } from './model.ts'

export class NotFound extends Error {}
export class Forbidden extends Error {}
export class InvalidTransition extends Error {}
export class S3Disabled extends Error {}

type EventRow = typeof events.$inferSelect
type TicketTypeRow = typeof ticketTypes.$inferSelect

const ticketTypeDTO = (row: TicketTypeRow) => ({
  ...row,
  salesStartAt: row.salesStartAt?.toISOString() ?? null,
  salesEndAt: row.salesEndAt?.toISOString() ?? null,
  createdAt: undefined,
  updatedAt: undefined,
})

async function eventDTO(row: EventRow): Promise<EventShape> {
  const [image] = await db
    .select()
    .from(eventImages)
    .where(eq(eventImages.eventId, row.id))
    .orderBy(asc(eventImages.position))
    .limit(1)
  return {
    ...row,
    categoryId: row.categoryId,
    venueId: row.venueId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    salesStartAt: row.salesStartAt.toISOString(),
    salesEndAt: row.salesEndAt.toISOString(),
    coverUrl: image && s3Enabled ? await presignGet(image.objectKey) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function assertManager(
  row: EventRow,
  user: { id: string; role: string; organizerApprovalStatus: string },
) {
  if (user.role === 'admin') return
  if (
    user.role !== 'organizer' ||
    user.organizerApprovalStatus !== 'APPROVED' ||
    row.ownerId !== user.id
  )
    throw new Forbidden()
}

export abstract class EventService {
  static async categories() {
    return db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories)
      .orderBy(asc(categories.name))
  }
  static async venues() {
    return db
      .select({
        id: venues.id,
        name: venues.name,
        address: venues.address,
        province: venues.province,
        postalCode: venues.postalCode,
        capacity: venues.capacity,
      })
      .from(venues)
      .orderBy(asc(venues.name))
  }

  static async list(query: {
    q?: string
    category?: string
    province?: string
    from?: string
    to?: string
    status?: string
    ownerId?: string
    page?: number
    pageSize?: number
  }) {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
    const filters = []
    if (query.status) filters.push(eq(events.status, query.status as EventRow['status']))
    if (query.ownerId) filters.push(eq(events.ownerId, query.ownerId))
    if (query.q) filters.push(ilike(events.title, `%${query.q}%`))
    if (query.category) filters.push(eq(categories.slug, query.category))
    if (query.province) filters.push(eq(venues.province, query.province))
    if (query.from) filters.push(gte(events.startsAt, new Date(query.from)))
    if (query.to) filters.push(lte(events.startsAt, new Date(query.to)))
    const where = and(...filters)
    const base = db
      .select({ event: events })
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .leftJoin(venues, eq(events.venueId, venues.id))
    const rows = await base
      .where(where)
      .orderBy(asc(events.startsAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
    const [totalRow] = await db
      .select({ total: count() })
      .from(events)
      .leftJoin(categories, eq(events.categoryId, categories.id))
      .leftJoin(venues, eq(events.venueId, venues.id))
      .where(where)
    return {
      items: await Promise.all(rows.map(({ event }) => eventDTO(event))),
      total: totalRow?.total ?? 0,
      page,
      pageSize,
    }
  }

  static async get(id: string) {
    const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1)
    if (!row) return null
    const types = await db
      .select()
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, id))
      .orderBy(asc(ticketTypes.price))
    return { ...(await eventDTO(row)), ticketTypes: types.map(ticketTypeDTO) }
  }

  static async checkoutSummary(id: string) {
    const detail = await this.get(id)
    if (!detail) return null
    return {
      id: detail.id,
      ownerId: detail.ownerId,
      title: detail.title,
      status: detail.status,
      refundPercent: detail.refundPercent,
      salesStartAt: detail.salesStartAt,
      salesEndAt: detail.salesEndAt,
      ticketTypes: detail.ticketTypes,
    }
  }

  static async create(
    input: EventInput,
    user: { id: string; role: string; organizerApprovalStatus: string },
  ) {
    if (
      user.role !== 'admin' &&
      (user.role !== 'organizer' || user.organizerApprovalStatus !== 'APPROVED')
    )
      throw new Forbidden()
    const [row] = await db
      .insert(events)
      .values({
        ...input,
        description: input.description ?? '',
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        salesStartAt: new Date(input.salesStartAt),
        salesEndAt: new Date(input.salesEndAt),
        refundPercent: input.refundPercent ?? 100,
        ownerId: user.id,
      })
      .returning()
    await db
      .insert(eventChangeLogs)
      .values({ eventId: row!.id, actorId: user.id, action: 'CREATED' })
    return eventDTO(row!)
  }

  static async update(
    id: string,
    input: EventInput,
    user: { id: string; role: string; organizerApprovalStatus: string },
  ) {
    const [current] = await db.select().from(events).where(eq(events.id, id)).limit(1)
    if (!current) throw new NotFound()
    assertManager(current, user)
    if (current.status !== 'DRAFT' && user.role !== 'admin') throw new InvalidTransition()
    const [row] = await db
      .update(events)
      .set({
        ...input,
        description: input.description ?? '',
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        salesStartAt: new Date(input.salesStartAt),
        salesEndAt: new Date(input.salesEndAt),
        updatedAt: new Date(),
      })
      .where(eq(events.id, id))
      .returning()
    await db.insert(eventChangeLogs).values({ eventId: id, actorId: user.id, action: 'UPDATED' })
    return eventDTO(row!)
  }

  static async transition(
    id: string,
    next: EventRow['status'],
    user: { id: string; role: string; organizerApprovalStatus: string },
  ) {
    const [current] = await db.select().from(events).where(eq(events.id, id)).limit(1)
    if (!current) throw new NotFound()
    assertManager(current, user)
    const allowed =
      (current.status === 'DRAFT' && next === 'PUBLISHED') ||
      (current.status === 'PUBLISHED' && next === 'CLOSED') ||
      (current.status === 'PUBLISHED' && next === 'SUSPENDED' && user.role === 'admin')
    if (!allowed) throw new InvalidTransition()
    if (next === 'PUBLISHED') {
      const [{ total = 0 } = {}] = await db
        .select({ total: sql<number>`coalesce(sum(${ticketTypes.quota}), 0)::int` })
        .from(ticketTypes)
        .where(eq(ticketTypes.eventId, id))
      if (total <= 0 || total > current.capacity)
        throw new InvalidTransition('ticket quota must be within event capacity')
    }
    const [row] = await db
      .update(events)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(events.id, id))
      .returning()
    await db.insert(eventChangeLogs).values({ eventId: id, actorId: user.id, action: next })
    return eventDTO(row!)
  }

  static async createTicketType(
    input: TicketTypeInput,
    user: { id: string; role: string; organizerApprovalStatus: string },
  ) {
    const [event] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1)
    if (!event) throw new NotFound()
    assertManager(event, user)
    if (event.status !== 'DRAFT') throw new InvalidTransition()
    const [{ total = 0 } = {}] = await db
      .select({ total: sql<number>`coalesce(sum(${ticketTypes.quota}), 0)::int` })
      .from(ticketTypes)
      .where(eq(ticketTypes.eventId, event.id))
    if (total + input.quota > event.capacity) throw new InvalidTransition('quota exceeds capacity')
    const [row] = await db
      .insert(ticketTypes)
      .values({
        ...input,
        description: input.description ?? '',
        maxPerOrder: input.maxPerOrder ?? 10,
        salesStartAt: input.salesStartAt ? new Date(input.salesStartAt) : null,
        salesEndAt: input.salesEndAt ? new Date(input.salesEndAt) : null,
      })
      .returning()
    return ticketTypeDTO(row!)
  }

  static async coverUpload(
    id: string,
    user: { id: string; role: string; organizerApprovalStatus: string },
    contentType: string,
  ) {
    if (!s3Enabled) throw new S3Disabled()
    const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1)
    if (!event) throw new NotFound()
    assertManager(event, user)
    const key = coverKeyFor(id, contentType)
    if (!key) throw new Error('unsupported content type')
    await db
      .insert(eventImages)
      .values({ eventId: id, objectKey: key, position: 0 })
      .onConflictDoUpdate({
        target: [eventImages.eventId, eventImages.position],
        set: { objectKey: key },
      })
    return { uploadUrl: await presignPut(key, contentType), key }
  }
}
