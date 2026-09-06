import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * `registration_db` — owned by `registration_svc`. No grants on the other databases.
 *
 * `registration` owns and enforces capacity by counting its own rows in one local
 * transaction (SYSTEM-DESIGN §4.3), which is why `event_title` and `event_capacity`
 * are denormalised here — copied from `event` over HTTP at booking time.
 *
 * `event_id` and `user_id` have NO foreign keys: both point at rows in other
 * databases.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(), // events.id — NO FK, different DB
    userId: text('user_id').notNull(), // better-auth user.id — NO FK, different DB
    eventTitle: text('event_title').notNull(), // denormalised at booking time
    eventCapacity: integer('event_capacity').notNull(), // copied at booking time
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tickets_event_user_unique').on(table.eventId, table.userId),
    index('tickets_event_id_idx').on(table.eventId),
  ],
)

export type Ticket = typeof tickets.$inferSelect
export type NewTicket = typeof tickets.$inferInsert
