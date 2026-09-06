import { t } from 'elysia'

/**
 * Request/response models for the event module — Elysia `t` (TypeBox) only,
 * registered on the controller via `.model()`. This is the single source of
 * truth for both validation and types; do not add a parallel Zod schema.
 */
export const EventModel = {
  event: t.Object({
    id: t.String({ format: 'uuid' }),
    title: t.String(),
    venue: t.String(),
    startsAt: t.String({ format: 'date-time' }),
    capacity: t.Integer({ minimum: 1 }),
  }),
}

export type EventShape = typeof EventModel.event.static
