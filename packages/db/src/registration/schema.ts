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

export const ticketInventory = pgTable(
  'ticket_inventory',
  {
    ticketTypeId: uuid('ticket_type_id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    totalQuota: integer('total_quota').notNull(),
    reservedCount: integer('reserved_count').notNull().default(0),
    soldCount: integer('sold_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('inventory_quota_positive', sql`${table.totalQuota} > 0`),
    check('inventory_reserved_nonnegative', sql`${table.reservedCount} >= 0`),
    check('inventory_sold_nonnegative', sql`${table.soldCount} >= 0`),
    check(
      'inventory_within_quota',
      sql`${table.reservedCount} + ${table.soldCount} <= ${table.totalQuota}`,
    ),
    index('ticket_inventory_event_idx').on(table.eventId),
  ],
)

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    eventId: uuid('event_id').notNull(),
    eventTitle: text('event_title').notNull(),
    status: text('status', {
      enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'PENDING_VERIFICATION', 'REFUNDED'],
    })
      .notNull()
      .default('PENDING'),
    currency: text('currency').notNull().default('THB'),
    refundPercent: integer('refund_percent').notNull().default(100),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
    total: numeric('total', { precision: 12, scale: 2 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('orders_subtotal_nonnegative', sql`${table.subtotal} >= 0`),
    check('orders_total_nonnegative', sql`${table.total} >= 0`),
    check('orders_refund_percent_valid', sql`${table.refundPercent} between 0 and 100`),
    index('orders_user_created_idx').on(table.userId, table.createdAt),
    index('orders_status_expiry_idx').on(table.status, table.expiresAt),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    ticketTypeName: text('ticket_type_name').notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    quantity: integer('quantity').notNull(),
    lineTotal: numeric('line_total', { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [
    unique('order_items_order_ticket_type_unique').on(table.orderId, table.ticketTypeId),
    check('order_items_quantity_positive', sql`${table.quantity} > 0`),
    check('order_items_unit_price_nonnegative', sql`${table.unitPrice} >= 0`),
    index('order_items_order_idx').on(table.orderId),
  ],
)

export const orderAuditLogs = pgTable(
  'order_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    details: text('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('order_audit_order_created_idx').on(table.orderId, table.createdAt)],
)

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    eventId: uuid('event_id').notNull(),
    userId: text('user_id').notNull(),
    eventTitle: text('event_title').notNull(),
    ticketTypeName: text('ticket_type_name').notNull(),
    status: text('status', { enum: ['VALID', 'USED', 'CANCELLED', 'REFUNDED'] })
      .notNull()
      .default('VALID'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tickets_user_issued_idx').on(table.userId, table.issuedAt),
    index('tickets_event_idx').on(table.eventId),
  ],
)

export const checkIns = pgTable(
  'check_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    eventId: uuid('event_id'),
    scannerId: text('scanner_id').notNull(),
    result: text('result', {
      enum: ['SUCCESS', 'DUPLICATE', 'INVALID', 'CANCELLED', 'REFUNDED', 'WRONG_EVENT'],
    }).notNull(),
    payloadHash: text('payload_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('check_ins_event_created_idx').on(table.eventId, table.createdAt)],
)

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    userId: text('user_id').notNull(),
    requestHash: text('request_hash').notNull(),
    resourceId: uuid('resource_id'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('idempotency_scope_key_unique').on(table.scope, table.key)],
)

export type Order = typeof orders.$inferSelect
export type Ticket = typeof tickets.$inferSelect
