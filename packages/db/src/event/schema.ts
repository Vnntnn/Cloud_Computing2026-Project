import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    province: text('province').notNull(),
    postalCode: text('postal_code'),
    capacity: integer('capacity'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('venues_capacity_positive', sql`${table.capacity} is null or ${table.capacity} > 0`),
  ],
)

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: ['DRAFT', 'PUBLISHED', 'CLOSED', 'SUSPENDED'] })
      .notNull()
      .default('DRAFT'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    salesStartAt: timestamp('sales_start_at', { withTimezone: true }).notNull(),
    salesEndAt: timestamp('sales_end_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    refundPercent: integer('refund_percent').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('events_capacity_positive', sql`${table.capacity} > 0`),
    check('events_time_valid', sql`${table.endsAt} > ${table.startsAt}`),
    check('events_sales_window_valid', sql`${table.salesEndAt} > ${table.salesStartAt}`),
    check('events_refund_percent_valid', sql`${table.refundPercent} between 0 and 100`),
    index('events_owner_idx').on(table.ownerId),
    index('events_status_starts_idx').on(table.status, table.startsAt),
  ],
)

export const ticketTypes = pgTable(
  'ticket_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    quota: integer('quota').notNull(),
    maxPerOrder: integer('max_per_order').notNull().default(10),
    salesStartAt: timestamp('sales_start_at', { withTimezone: true }),
    salesEndAt: timestamp('sales_end_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('ticket_types_event_name_unique').on(table.eventId, table.name),
    check('ticket_types_price_nonnegative', sql`${table.price} >= 0`),
    check('ticket_types_quota_positive', sql`${table.quota} > 0`),
    check('ticket_types_max_per_order_positive', sql`${table.maxPerOrder} > 0`),
    check(
      'ticket_types_sales_window_valid',
      sql`${table.salesStartAt} is null or ${table.salesEndAt} is null or ${table.salesEndAt} > ${table.salesStartAt}`,
    ),
    index('ticket_types_event_idx').on(table.eventId),
  ],
)

export const eventImages = pgTable(
  'event_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull().unique(),
    altText: text('alt_text').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('event_images_event_position_unique').on(table.eventId, table.position),
    check('event_images_position_nonnegative', sql`${table.position} >= 0`),
  ],
)

export const eventChangeLogs = pgTable(
  'event_change_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    details: text('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('event_change_logs_event_created_idx').on(table.eventId, table.createdAt)],
)

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type TicketType = typeof ticketTypes.$inferSelect
