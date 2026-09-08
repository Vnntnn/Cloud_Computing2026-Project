import { beforeEach, describe, expect, it } from 'bun:test'
import { eventChangeLogs, events, ticketTypes } from '@eventide/db/event'
import { eq, sql } from 'drizzle-orm'
import { db } from '../src/lib/db.ts'
import { EventService, InvalidTransition } from '../src/modules/event/service.ts'

const manager = {
  id: 'organizer-event-update',
  role: 'organizer',
  organizerApprovalStatus: 'APPROVED',
}

const updateInput = {
  title: 'Updated published event',
  description: 'Updated after publishing',
  startsAt: '2026-10-10T10:00:00.000Z',
  endsAt: '2026-10-10T12:00:00.000Z',
  salesStartAt: '2026-09-01T00:00:00.000Z',
  salesEndAt: '2026-10-10T09:00:00.000Z',
  capacity: 100,
  refundPercent: 75,
}

async function resetEventDb() {
  await db.execute(
    sql`truncate event_change_logs, event_images, ticket_types, events, categories, venues restart identity cascade`,
  )
}

async function createEvent(status: 'DRAFT' | 'PUBLISHED' | 'CLOSED') {
  const [event] = await db
    .insert(events)
    .values({
      ownerId: manager.id,
      title: 'Event update test',
      status,
      startsAt: new Date('2026-10-10T10:00:00Z'),
      endsAt: new Date('2026-10-10T12:00:00Z'),
      salesStartAt: new Date('2026-09-01T00:00:00Z'),
      salesEndAt: new Date('2026-10-10T09:00:00Z'),
      capacity: 100,
    })
    .returning()
  if (!event) throw new Error('test event was not created')
  return event
}

describe('event updates', () => {
  beforeEach(resetEventDb)

  it('allows an owner to update a published event and records the change', async () => {
    const event = await createEvent('PUBLISHED')

    const updated = await EventService.update(event.id, updateInput, manager)

    expect(updated.title).toBe(updateInput.title)
    expect(updated.status).toBe('PUBLISHED')
    expect(updated.refundPercent).toBe(75)
    const logs = await db
      .select()
      .from(eventChangeLogs)
      .where(eq(eventChangeLogs.eventId, event.id))
    expect(logs.map((log) => log.action)).toContain('UPDATED')
  })

  it('keeps closed events locked for organizer updates', async () => {
    const event = await createEvent('CLOSED')

    expect(EventService.update(event.id, updateInput, manager)).rejects.toBeInstanceOf(
      InvalidTransition,
    )
  })

  it('rejects capacity below the existing ticket quota', async () => {
    const event = await createEvent('PUBLISHED')
    await db.insert(ticketTypes).values({
      eventId: event.id,
      name: 'General admission',
      price: '500.00',
      quota: 80,
    })

    expect(
      EventService.update(event.id, { ...updateInput, capacity: 79 }, manager),
    ).rejects.toThrow('event capacity cannot be below ticket quota')
  })
})
