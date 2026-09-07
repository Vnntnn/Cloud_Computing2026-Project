import { bearerAuth } from '@eventide/shared/auth'
import { ErrorResponse } from '@eventide/shared/models'
import { Elysia, t } from 'elysia'
import { env } from '../../env.ts'
import { EventNotFound, EventServiceUnavailable } from '../../lib/event-client.ts'
import { RegistrationModel } from './model.ts'
import { AlreadyRegistered, CapacityFull, RegistrationService } from './service.ts'

/**
 * Controller = one Elysia instance, unbroken method chain (Eden depends on it).
 * `{ auth: true }` routes get a verified `user` via the shared bearer-JWT macro
 * (local `jose` verification vs auth's JWKS — §5.1).
 */
export const registration = new Elysia({ prefix: '/api/registrations', tags: ['registrations'] })
  .use(
    bearerAuth({
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_BASE_URL,
      audience: env.AUTH_BASE_URL,
    }),
  )
  .model(RegistrationModel)
  .get('/me', ({ user }) => RegistrationService.listMine(user.id), {
    auth: true,
    response: { 200: t.Array(RegistrationModel.ticket), 401: ErrorResponse },
    detail: { summary: 'List my tickets (title denormalised at booking time)' },
  })
  .get('/event/:id/count', ({ params }) => RegistrationService.countFor(params.id), {
    params: t.Object({ id: t.String({ format: 'uuid' }) }),
    response: { 200: RegistrationModel.count },
    detail: { summary: 'How many tickets exist for an event' },
  })
  .post(
    '/',
    async ({ body, user, status }) => {
      try {
        return await RegistrationService.book(body.eventId, user.id)
      } catch (err) {
        if (err instanceof EventNotFound) {
          return status(404, { error: 'event_not_found', message: 'event not found' })
        }
        if (err instanceof CapacityFull) {
          return status(409, { error: 'capacity_full', message: 'event is at capacity' })
        }
        if (err instanceof AlreadyRegistered) {
          return status(409, { error: 'already_registered', message: 'you already have a ticket' })
        }
        if (err instanceof EventServiceUnavailable) {
          return status(502, {
            error: 'event_unavailable',
            message: 'could not reach the event service',
          })
        }
        throw err
      }
    },
    {
      auth: true,
      body: RegistrationModel.createTicket,
      response: {
        200: RegistrationModel.ticket,
        401: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
        502: ErrorResponse,
      },
      detail: { summary: 'Book a ticket — capacity enforced in one local transaction' },
    },
  )
