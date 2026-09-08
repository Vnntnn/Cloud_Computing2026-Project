import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull(),
    userId: text('user_id').notNull(),
    status: text('status', {
      enum: ['PROCESSING', 'SUCCEEDED', 'PENDING_VERIFICATION', 'FAILED', 'REFUNDED'],
    })
      .notNull()
      .default('PROCESSING'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('THB'),
    provider: text('provider').notNull().default('mock'),
    providerReference: text('provider_reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('payments_order_unique').on(table.orderId),
    index('payments_user_idx').on(table.userId),
  ],
)

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    status: text('status', { enum: ['STARTED', 'SUCCEEDED', 'FAILED'] }).notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('payment_attempts_idempotency_unique').on(table.idempotencyKey)],
)

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    status: text('status', { enum: ['PROCESSING', 'SUCCEEDED', 'FAILED'] }).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [unique('refunds_order_unique').on(table.orderId)],
)
