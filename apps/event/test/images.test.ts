import { beforeEach, describe, expect, it } from 'bun:test'
import { eventImages, events } from '@eventide/db/event'
import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db.ts'
import { EventService, InvalidTransition } from '../src/modules/event/service.ts'

const manager = {
  id: 'organizer-images',
  role: 'organizer',
  organizerApprovalStatus: 'APPROVED',
}

async function resetEventDb() {
  await db.execute(
    sql`truncate event_change_logs, event_images, ticket_types, events, categories, venues restart identity cascade`,
  )
}

async function createEvent() {
  const [event] = await db
    .insert(events)
    .values({
      ownerId: manager.id,
      title: 'Image management test',
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

describe('event images', () => {
  beforeEach(resetEventDb)

  it('appends images and persists a complete reordered sequence', async () => {
    const event = await createEvent()
    const cover = await EventService.prepareImageUpload(
      event.id,
      manager,
      'image/png',
      'Main stage',
    )
    const second = await EventService.prepareImageUpload(
      event.id,
      manager,
      'image/jpeg',
      'Audience',
      true,
    )
    const third = await EventService.prepareImageUpload(
      event.id,
      manager,
      'image/webp',
      'Venue entrance',
      true,
    )

    expect([cover.position, second.position, third.position]).toEqual([0, 1, 2])
    const reordered = await EventService.reorderImages(
      event.id,
      [third.imageId, cover.imageId, second.imageId],
      manager,
    )
    expect(reordered.map((image) => image.id)).toEqual([
      third.imageId,
      cover.imageId,
      second.imageId,
    ])
    expect(reordered.map((image) => image.position)).toEqual([0, 1, 2])
    expect(reordered.every((image) => image.url?.includes('X-Amz-Signature='))).toBe(true)

    const stored = await db.select().from(eventImages)
    expect(stored).toHaveLength(3)
  })

  it('rejects an order that omits an image', async () => {
    const event = await createEvent()
    const cover = await EventService.prepareImageUpload(event.id, manager, 'image/png')
    await EventService.prepareImageUpload(event.id, manager, 'image/jpeg', '', true)

    expect(EventService.reorderImages(event.id, [cover.imageId], manager)).rejects.toBeInstanceOf(
      InvalidTransition,
    )
  })
})
