import { describe, expect, it } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { events } from './event/schema.ts'
import { orders, ticketInventory, tickets } from './registration/schema.ts'

describe('event_db schema', () => {
  it('events.owner_id is text, not uuid (better-auth ids are text — CLAUDE.md)', () => {
    const { columns } = getTableConfig(events)
    const ownerId = columns.find((c) => c.name === 'owner_id')
    expect(ownerId?.getSQLType()).toBe('text')
  })
})

describe('registration_db schema', () => {
  it('cross-database identifiers do not have foreign keys', () => {
    expect(getTableConfig(orders).foreignKeys).toHaveLength(0)
    expect(getTableConfig(ticketInventory).foreignKeys).toHaveLength(0)
  })

  it('tickets.user_id is text, not uuid', () => {
    const { columns } = getTableConfig(tickets)
    expect(columns.find((c) => c.name === 'user_id')?.getSQLType()).toBe('text')
  })

  it('inventory has database checks protecting quota counters', () => {
    const names = getTableConfig(ticketInventory).checks.map((check) => check.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'inventory_within_quota',
        'inventory_reserved_nonnegative',
        'inventory_sold_nonnegative',
      ]),
    )
  })
})
