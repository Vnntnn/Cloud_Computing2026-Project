import { tickets } from '@eventide/db/registration'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../lib/db.ts'
import { fetchEventSummary } from '../../lib/event-client.ts'
import type { Ticket, TicketCount } from './model.ts'

/** Capacity is full for the requested event. */
export class CapacityFull extends Error {}
/** This user already holds a ticket for the event. */
export class AlreadyRegistered extends Error {}

type Row = typeof tickets.$inferSelect

function toDTO(row: Row): Ticket {
  return {
    id: row.id,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    eventCapacity: row.eventCapacity,
    createdAt: row.createdAt.toISOString(),
  }
}

async function countTickets(runner: Pick<typeof db, 'select'>, eventId: string): Promise<number> {
  const rows = await runner
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(eq(tickets.eventId, eventId))
  return rows[0]?.count ?? 0
}

export abstract class RegistrationService {
  static async listMine(userId: string): Promise<Ticket[]> {
    const rows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.userId, userId))
      .orderBy(desc(tickets.createdAt))
    return rows.map(toDTO)
  }

  static async countFor(eventId: string): Promise<TicketCount> {
    return { eventId, count: await countTickets(db, eventId) }
  }

  /**
   * Book a ticket. `registration` owns capacity enforcement (SYSTEM-DESIGN §4.3):
   * it reads the capacity NUMBER from `event` once over HTTP, then enforces it by
   * counting its OWN `tickets` rows inside a single local transaction —
   * serialised per-event by a transaction-scoped advisory lock so two concurrent
   * bookings for the last seat cannot both succeed. No distributed transaction.
   */
  static async book(eventId: string, userId: string): Promise<Ticket> {
    // Throws EventNotFound / EventServiceUnavailable — mapped to 404 / 502 above.
    const summary = await fetchEventSummary(eventId)

    return db.transaction(async (tx) => {
      // Advisory lock keyed on the event id, released automatically at
      // commit/rollback. Blocks other bookers for the same event only.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`)

      // Already booked? Checked before capacity — "you already have a ticket" is
      // the more useful answer than "event is full" when both are true.
      const mine = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.eventId, eventId), eq(tickets.userId, userId)))
        .limit(1)
      if (mine.length > 0) throw new AlreadyRegistered()

      if ((await countTickets(tx, eventId)) >= summary.capacity) {
        throw new CapacityFull()
      }

      try {
        const rows = await tx
          .insert(tickets)
          .values({
            eventId,
            userId,
            eventTitle: summary.title,
            eventCapacity: summary.capacity,
          })
          .returning()
        // A single-row insert with .returning() always yields the row.
        return toDTO(rows[0] as Row)
      } catch (err) {
        // unique (event_id, user_id) — the caller already has a ticket.
        if (err instanceof Error && (err as { code?: string }).code === '23505') {
          throw new AlreadyRegistered()
        }
        throw err
      }
    })
  }
}
