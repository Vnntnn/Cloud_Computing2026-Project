import { describe, expect, it } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { user } from './auth/schema.ts'
import { eventImages, events, ticketTypes, venues } from './event/schema.ts'
import { payments, refunds } from './payment/schema.ts'
import {
  checkIns,
  idempotencyKeys,
  orderItems,
  orders,
  ticketInventory,
  tickets,
} from './registration/schema.ts'

const columnType = (table: Parameters<typeof getTableConfig>[0], name: string) =>
  getTableConfig(table)
    .columns.find((c) => c.name === name)
    ?.getSQLType()

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map((c) => c.name)

const uniqueNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).uniqueConstraints.map((c) => c.name)

describe('cross-database identifiers are text, never uuid (better-auth ids — CLAUDE.md)', () => {
  it('auth user.id is text', () => {
    expect(columnType(user, 'id')).toBe('text')
  })
  it('event_db.events.owner_id is text', () => {
    expect(columnType(events, 'owner_id')).toBe('text')
  })
  it('registration_db user references are text', () => {
    expect(columnType(orders, 'user_id')).toBe('text')
    expect(columnType(tickets, 'user_id')).toBe('text')
    expect(columnType(checkIns, 'scanner_id')).toBe('text')
  })
  it('payment_db.payments.user_id is text', () => {
    expect(columnType(payments, 'user_id')).toBe('text')
  })
})

describe('no foreign keys cross a database boundary', () => {
  it('registration tables that point at event/auth rows hold no FK', () => {
    expect(getTableConfig(orders).foreignKeys).toHaveLength(0)
    expect(getTableConfig(ticketInventory).foreignKeys).toHaveLength(0)
    // tickets FK only its own order/order_item, never event_id/user_id
    const ticketFkCols = getTableConfig(tickets).foreignKeys.flatMap((fk) =>
      fk.reference().columns.map((c) => c.name),
    )
    expect(ticketFkCols).not.toContain('event_id')
    expect(ticketFkCols).not.toContain('user_id')
  })
  it('every payment table references only payment_db (or nothing)', () => {
    for (const table of [payments, refunds]) {
      for (const fk of getTableConfig(table).foreignKeys) {
        expect(getTableConfig(fk.reference().foreignTable).name).toBe('payments')
      }
    }
    expect(getTableConfig(payments).foreignKeys).toHaveLength(0)
  })
})

describe('database CHECK constraints protect the invariants', () => {
  it('ticket_inventory cannot oversell', () => {
    expect(checkNames(ticketInventory)).toEqual(
      expect.arrayContaining([
        'inventory_quota_positive',
        'inventory_reserved_nonnegative',
        'inventory_sold_nonnegative',
        'inventory_within_quota',
      ]),
    )
  })
  it('orders and order_items keep money and quantities sane', () => {
    expect(checkNames(orders)).toEqual(
      expect.arrayContaining([
        'orders_subtotal_nonnegative',
        'orders_total_nonnegative',
        'orders_refund_percent_valid',
      ]),
    )
    expect(checkNames(orderItems)).toEqual(
      expect.arrayContaining([
        'order_items_quantity_positive',
        'order_items_unit_price_nonnegative',
      ]),
    )
  })
  it('events and ticket_types enforce valid windows and quotas', () => {
    expect(checkNames(events)).toEqual(
      expect.arrayContaining([
        'events_capacity_positive',
        'events_time_valid',
        'events_sales_window_valid',
        'events_refund_percent_valid',
      ]),
    )
    expect(checkNames(ticketTypes)).toEqual(
      expect.arrayContaining([
        'ticket_types_price_nonnegative',
        'ticket_types_quota_positive',
        'ticket_types_max_per_order_positive',
      ]),
    )
    expect(checkNames(venues)).toContain('venues_capacity_positive')
  })
})

describe('unique constraints make idempotency and one-row invariants enforceable', () => {
  it('idempotency + one-payment-per-order + one-item-per-type', () => {
    expect(uniqueNames(idempotencyKeys)).toContain('idempotency_scope_key_unique')
    expect(uniqueNames(orderItems)).toContain('order_items_order_ticket_type_unique')
    expect(uniqueNames(payments)).toContain('payments_order_unique')
    expect(uniqueNames(refunds)).toContain('refunds_order_unique')
  })
  it('event catalog uniqueness (image position, ticket-type name)', () => {
    expect(uniqueNames(eventImages)).toContain('event_images_event_position_unique')
    expect(uniqueNames(ticketTypes)).toContain('ticket_types_event_name_unique')
  })
})
