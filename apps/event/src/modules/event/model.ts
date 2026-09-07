import { t } from 'elysia'

const money = t.String({ pattern: '^\\d+(\\.\\d{2})$' })
const nullableUuid = t.Union([t.String({ format: 'uuid' }), t.Null()])

const category = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  slug: t.String(),
})

const venue = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  address: t.String(),
  province: t.String(),
  postalCode: t.Union([t.String(), t.Null()]),
  capacity: t.Union([t.Integer(), t.Null()]),
})

const ticketType = t.Object({
  id: t.String({ format: 'uuid' }),
  eventId: t.String({ format: 'uuid' }),
  name: t.String(),
  description: t.String(),
  price: money,
  quota: t.Integer(),
  maxPerOrder: t.Integer(),
  salesStartAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
  salesEndAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
})

const event = t.Object({
  id: t.String({ format: 'uuid' }),
  categoryId: nullableUuid,
  venueId: nullableUuid,
  title: t.String(),
  description: t.String(),
  status: t.Union([
    t.Literal('DRAFT'),
    t.Literal('PUBLISHED'),
    t.Literal('CLOSED'),
    t.Literal('SUSPENDED'),
  ]),
  startsAt: t.String({ format: 'date-time' }),
  endsAt: t.String({ format: 'date-time' }),
  salesStartAt: t.String({ format: 'date-time' }),
  salesEndAt: t.String({ format: 'date-time' }),
  capacity: t.Integer(),
  refundPercent: t.Integer(),
  coverUrl: t.Union([t.String(), t.Null()]),
  ownerId: t.String(),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
})

const eventDetail = t.Composite([event, t.Object({ ticketTypes: t.Array(ticketType) })])
const paginatedEvents = t.Object({
  items: t.Array(event),
  total: t.Integer(),
  page: t.Integer(),
  pageSize: t.Integer(),
})

const eventInput = t.Object({
  categoryId: t.Optional(t.String({ format: 'uuid' })),
  venueId: t.Optional(t.String({ format: 'uuid' })),
  title: t.String({ minLength: 1, maxLength: 200 }),
  description: t.Optional(t.String({ maxLength: 10000 })),
  startsAt: t.String({ format: 'date-time' }),
  endsAt: t.String({ format: 'date-time' }),
  salesStartAt: t.String({ format: 'date-time' }),
  salesEndAt: t.String({ format: 'date-time' }),
  capacity: t.Integer({ minimum: 1 }),
  refundPercent: t.Optional(t.Integer({ minimum: 0, maximum: 100 })),
})

const ticketTypeInput = t.Object({
  eventId: t.String({ format: 'uuid' }),
  name: t.String({ minLength: 1, maxLength: 100 }),
  description: t.Optional(t.String({ maxLength: 1000 })),
  price: money,
  quota: t.Integer({ minimum: 1 }),
  maxPerOrder: t.Optional(t.Integer({ minimum: 1, maximum: 20 })),
  salesStartAt: t.Optional(t.String({ format: 'date-time' })),
  salesEndAt: t.Optional(t.String({ format: 'date-time' })),
})

const checkoutSummary = t.Object({
  id: t.String({ format: 'uuid' }),
  ownerId: t.String(),
  title: t.String(),
  status: t.String(),
  refundPercent: t.Integer(),
  salesStartAt: t.String({ format: 'date-time' }),
  salesEndAt: t.String({ format: 'date-time' }),
  ticketTypes: t.Array(ticketType),
})

export const EventModel = {
  category,
  venue,
  ticketType,
  event,
  eventDetail,
  paginatedEvents,
  eventInput,
  ticketTypeInput,
  checkoutSummary,
  coverUploadBody: t.Object({
    contentType: t.Union([
      t.Literal('image/jpeg'),
      t.Literal('image/png'),
      t.Literal('image/webp'),
    ]),
  }),
  coverUpload: t.Object({ uploadUrl: t.String(), key: t.String() }),
}

export type EventShape = typeof event.static
export type EventInput = typeof eventInput.static
export type TicketTypeInput = typeof ticketTypeInput.static
