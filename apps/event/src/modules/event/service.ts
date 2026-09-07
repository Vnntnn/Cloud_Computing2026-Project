import { events } from '@eventide/db/event'
import { desc, eq } from 'drizzle-orm'
import { db } from '../../lib/db.ts'
import { coverKeyFor, presignGet, presignPut, s3Enabled } from '../../lib/s3.ts'
import type { CreateEventBody, EventShape, EventSummary } from './model.ts'

/**
 * Business logic over `event_db` (SYSTEM-DESIGN §12.2). Rows come back with
 * `Date` columns; every method returns the wire shape (ISO strings) so the
 * controller can hand results straight to the response validator.
 */

type Row = typeof events.$inferSelect

/** Owner tried to act on someone else's event. */
export class NotOwner extends Error {}
/** Cover upload requested but no S3 bucket is configured. */
export class S3Disabled extends Error {}

function toDTO(row: Row, coverUrl: string | null = null): EventShape {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    venue: row.venue,
    startsAt: row.startsAt.toISOString(),
    capacity: row.capacity,
    coverUrl,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
  }
}

export abstract class EventService {
  /** List — no cover URLs (would mean signing N urls per request). */
  static async list(): Promise<EventShape[]> {
    const rows = await db.select().from(events).orderBy(desc(events.startsAt))
    return rows.map((r) => toDTO(r))
  }

  /** One event — with a presigned cover URL when it has an image. */
  static async get(id: string): Promise<EventShape | null> {
    const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1)
    if (!row) return null
    const coverUrl = row.coverKey && s3Enabled ? await presignGet(row.coverKey) : null
    return toDTO(row, coverUrl)
  }

  /** Trimmed shape for `registration`'s in-cluster enrichment call (§4.4). */
  static async summary(id: string): Promise<EventSummary | null> {
    const [row] = await db
      .select({ id: events.id, title: events.title, capacity: events.capacity })
      .from(events)
      .where(eq(events.id, id))
      .limit(1)
    return row ?? null
  }

  static async create(input: CreateEventBody, ownerId: string): Promise<EventShape> {
    const [row] = await db
      .insert(events)
      .values({
        title: input.title,
        description: input.description ?? '',
        venue: input.venue,
        startsAt: new Date(input.startsAt),
        capacity: input.capacity,
        ownerId,
      })
      .returning()
    // `.returning()` on a single insert always yields the row.
    return toDTO(row as Row)
  }

  /**
   * Presigned PUT for a cover image. The owner uploads the bytes straight to S3
   * (§12); we record the key now so a later GET can presign it. Idempotent — a
   * re-upload to the same key just replaces the object.
   */
  static async coverUpload(
    id: string,
    ownerId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    if (!s3Enabled) throw new S3Disabled()
    const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1)
    if (!row) throw new Error('not found')
    if (row.ownerId !== ownerId) throw new NotOwner()

    const key = coverKeyFor(id, contentType)
    if (!key) throw new Error('unsupported content type')

    await db.update(events).set({ coverKey: key }).where(eq(events.id, id))
    return { uploadUrl: await presignPut(key, contentType), key }
  }
}
