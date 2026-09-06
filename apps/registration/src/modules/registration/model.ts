import { t } from 'elysia'

/**
 * Request/response models for the registration module — Elysia `t` only,
 * registered via `.model()`.
 */
export const RegistrationModel = {
  createTicket: t.Object({
    eventId: t.String({ format: 'uuid' }),
  }),
  ticket: t.Object({
    id: t.String({ format: 'uuid' }),
    eventId: t.String({ format: 'uuid' }),
    eventTitle: t.String(),
    createdAt: t.String({ format: 'date-time' }),
  }),
}

export type CreateTicket = typeof RegistrationModel.createTicket.static
export type Ticket = typeof RegistrationModel.ticket.static
