import { events } from '@eventide/db/event'
import { desc, eq } from 'drizzle-orm'
import { db } from '../../lib/db.ts'
import type { CreateEventBody, EventShape, EventSummary } from './model.ts'

/**
 * Business logic over `event_db` (SYSTEM-DESIGN §12.2). Rows come back with
 * `Date` columns; every method returns the wire shape (ISO strings) so the
 * controller can hand results straight to the response validator.
 */

type Row = typeof events.$inferSelect

function toDTO(row: Row): EventShape {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    venue: row.venue,
    startsAt: row.startsAt.toISOString(),
    capacity: row.capacity,
    coverKey: row.coverKey,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
  }
}

export abstract class EventService {
  static async list(): Promise<EventShape[]> {
    const rows = await db.select().from(events).orderBy(desc(events.startsAt))
    return rows.map(toDTO)
  }

  static async get(id: string): Promise<EventShape | null> {
    const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1)
    return row ? toDTO(row) : null
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
}
