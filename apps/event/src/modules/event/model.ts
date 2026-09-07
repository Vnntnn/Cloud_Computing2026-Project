import { t } from 'elysia'

/**
 * Request/response models for the event module — Elysia `t` (TypeBox) only, the
 * single source of truth for validation *and* types. Do not add a parallel Zod
 * schema (it would break Eden inference — CLAUDE.md).
 */

const event = t.Object({
  id: t.String({ format: 'uuid' }),
  title: t.String({ minLength: 1, maxLength: 200 }),
  description: t.String({ default: '' }),
  venue: t.String({ minLength: 1, maxLength: 200 }),
  startsAt: t.String({ format: 'date-time' }),
  capacity: t.Integer({ minimum: 1 }),
  // Presigned GET URL for the cover image (1 h), or null. The raw S3 key never
  // leaves the service.
  coverUrl: t.Union([t.String(), t.Null()]),
  ownerId: t.String(), // better-auth user.id — text, not uuid
  createdAt: t.String({ format: 'date-time' }),
})

const createBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 200 }),
  description: t.Optional(t.String({ maxLength: 5000 })),
  venue: t.String({ minLength: 1, maxLength: 200 }),
  startsAt: t.String({ format: 'date-time' }),
  capacity: t.Integer({ minimum: 1 }),
})

/** The trimmed shape `registration` reads over HTTP at booking time (§4.4). */
const summary = t.Object({
  id: t.String({ format: 'uuid' }),
  title: t.String(),
  capacity: t.Integer({ minimum: 1 }),
})

const coverUploadBody = t.Object({
  contentType: t.Union([t.Literal('image/jpeg'), t.Literal('image/png'), t.Literal('image/webp')]),
})

/** Presigned PUT the browser uploads the cover image to (bytes skip the pod). */
const coverUpload = t.Object({
  uploadUrl: t.String(),
  key: t.String(),
})

export const EventModel = { event, createBody, summary, coverUploadBody, coverUpload }

export type EventShape = typeof event.static
export type CreateEventBody = typeof createBody.static
export type EventSummary = typeof summary.static
