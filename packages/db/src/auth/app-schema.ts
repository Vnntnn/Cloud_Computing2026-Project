import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './schema.ts'

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    ipAddress: text('ip_address'),
    outcome: text('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_attempts_email_created_idx').on(table.email, table.createdAt)],
)

export const userAuditLogs = pgTable(
  'user_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    targetUserId: text('target_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    details: text('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('user_audit_target_created_idx').on(table.targetUserId, table.createdAt)],
)
