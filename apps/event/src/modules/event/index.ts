import { bearerAuth } from '@eventide/shared/auth'
import { ErrorResponse } from '@eventide/shared/models'
import { Elysia, t } from 'elysia'
import { env } from '../../env.ts'
import { EventModel } from './model.ts'
import { EventService } from './service.ts'

/**
 * Controller = one Elysia instance, unbroken method chain (Eden depends on it).
 * `{ auth: true }` routes get a verified `user` via the shared bearer-JWT macro
 * — local `jose` verification against auth's JWKS, no hop to auth (§5.1).
 */
export const event = new Elysia({ prefix: '/api/events', tags: ['events'] })
  .use(
    bearerAuth({
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_BASE_URL,
      audience: env.AUTH_BASE_URL,
    }),
  )
  .model(EventModel)
  .get('/', () => EventService.list(), {
    response: { 200: t.Array(EventModel.event) },
    detail: { summary: 'List events' },
  })
  .get(
    '/:id',
    async ({ params, status }) => {
      const found = await EventService.get(params.id)
      return found ?? status(404, { error: 'not_found', message: 'event not found' })
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: EventModel.event, 404: ErrorResponse },
      detail: { summary: 'Get one event' },
    },
  )
  .get(
    '/:id/summary',
    async ({ params, status }) => {
      const found = await EventService.summary(params.id)
      return found ?? status(404, { error: 'not_found', message: 'event not found' })
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: EventModel.summary, 404: ErrorResponse },
      detail: { summary: 'Event summary (in-cluster, used by registration)' },
    },
  )
  .post('/', ({ body, user }) => EventService.create(body, user.id), {
    auth: true,
    body: EventModel.createBody,
    response: { 200: EventModel.event, 401: ErrorResponse },
    detail: { summary: 'Create an event' },
  })
