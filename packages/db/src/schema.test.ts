import { describe, expect, it } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { events } from './event/schema.ts'
import { tickets } from './registration/schema.ts'

describe('event_db schema', () => {
  it('events.owner_id is text, not uuid (better-auth ids are text — CLAUDE.md)', () => {
    const { columns } = getTableConfig(events)
    const ownerId = columns.find((c) => c.name === 'owner_id')
    expect(ownerId?.getSQLType()).toBe('text')
  })
})

describe('registration_db schema', () => {
  it('tickets has a unique (event_id, user_id) constraint', () => {
    const { uniqueConstraints } = getTableConfig(tickets)
    const cols = uniqueConstraints.flatMap((u) => u.columns.map((c) => c.name))
    expect(cols).toEqual(expect.arrayContaining(['event_id', 'user_id']))
  })

  it('tickets.user_id is text, not uuid', () => {
    const { columns } = getTableConfig(tickets)
    expect(columns.find((c) => c.name === 'user_id')?.getSQLType()).toBe('text')
  })
})
