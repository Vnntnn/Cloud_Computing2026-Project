import { t } from 'elysia'

/**
 * Request/response models for the registration module — Elysia `t` only,
 * registered via `.model()`. Single source of truth for validation and types;
 * no parallel Zod schema (CLAUDE.md).
 */

const createTicket = t.Object({
  eventId: t.String({ format: 'uuid' }),
})

// `event_title` / `event_capacity` are denormalised onto the ticket at booking
// time (§4.3), so "my tickets" needs no join and no second hop to `event`.
const ticket = t.Object({
  id: t.String({ format: 'uuid' }),
  eventId: t.String({ format: 'uuid' }),
  eventTitle: t.String(),
  eventCapacity: t.Integer({ minimum: 1 }),
  createdAt: t.String({ format: 'date-time' }),
})

const count = t.Object({
  eventId: t.String({ format: 'uuid' }),
  count: t.Integer({ minimum: 0 }),
})

export const RegistrationModel = { createTicket, ticket, count }

export type CreateTicket = typeof createTicket.static
export type Ticket = typeof ticket.static
export type TicketCount = typeof count.static
