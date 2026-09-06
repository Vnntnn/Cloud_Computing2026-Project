import { sql } from 'drizzle-orm'
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * `event_db` — owned by `event_svc`. No grants on the other databases.
 *
 * `owner_id` is `text`, not `uuid`: it references a better-auth `user.id`, which
 * better-auth generates as `text`. There is NO foreign key — it lives in another
 * database and Postgres cannot join across databases (SYSTEM-DESIGN §4).
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    venue: text('venue').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    coverKey: text('cover_key'), // S3 object key, not a URL
    ownerId: text('owner_id').notNull(), // better-auth user.id — NO FK, different DB
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('events_capacity_positive', sql`${table.capacity} > 0`)],
)

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
