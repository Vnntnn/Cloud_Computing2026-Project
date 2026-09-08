import { bearerAuth } from '@eventide/shared/auth'
import { internalTokenMatches } from '@eventide/shared/internal'
import { ErrorResponse } from '@eventide/shared/models'
import { Elysia, t } from 'elysia'
import { env } from '../../env.ts'
import { EventModel } from './model.ts'
import { EventService, Forbidden, InvalidTransition, NotFound, S3Disabled } from './service.ts'

const error = (err: unknown) => {
  const response = (status: number, body: { error: string; message: string }) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (err instanceof NotFound)
    return response(404, { error: 'not_found', message: err.message || 'resource not found' })
  if (err instanceof Forbidden)
    return response(403, { error: 'forbidden', message: 'insufficient permission' })
  if (err instanceof InvalidTransition)
    return response(409, {
      error: 'invalid_transition',
      message: err.message || 'invalid lifecycle transition',
    })
  if (err instanceof S3Disabled)
    return response(501, { error: 's3_disabled', message: 'uploads are not configured' })
  throw err
}

export const event = new Elysia({ tags: ['catalog'] })
  .use(
    bearerAuth({
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_BASE_URL,
      audience: env.AUTH_BASE_URL,
    }),
  )
  .model(EventModel)
  .get('/api/categories', () => EventService.categories(), {
    response: t.Array(EventModel.category),
  })
  .get('/api/venues', () => EventService.venues(), { response: t.Array(EventModel.venue) })
  .get('/api/events', ({ query }) => EventService.list({ ...query, status: 'PUBLISHED' }), {
    query: t.Object({
      q: t.Optional(t.String()),
      category: t.Optional(t.String()),
      province: t.Optional(t.String()),
      from: t.Optional(t.String({ format: 'date-time' })),
      to: t.Optional(t.String({ format: 'date-time' })),
      page: t.Optional(t.Integer({ minimum: 1 })),
      pageSize: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }),
    response: EventModel.paginatedEvents,
  })
  .get(
    '/api/organizer/events',
    ({ query, user, status }) => {
      if (user.role !== 'organizer' && user.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'organizer role required' })
      if (user.role === 'organizer' && user.organizerApprovalStatus !== 'APPROVED')
        return status(403, { error: 'forbidden', message: 'organizer approval required' })
      return EventService.list({
        status: query.status,
        ownerId: user.role === 'admin' ? undefined : user.id,
        page: query.page,
        pageSize: query.pageSize,
      })
    },
    {
      auth: true,
      query: t.Object({
        status: t.Optional(
          t.Union([
            t.Literal('DRAFT'),
            t.Literal('PUBLISHED'),
            t.Literal('CLOSED'),
            t.Literal('SUSPENDED'),
          ]),
        ),
        page: t.Optional(t.Integer({ minimum: 1 })),
        pageSize: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      }),
    },
  )
  .get(
    '/api/events/:id',
    async ({ params, status }) =>
      (await EventService.get(params.id)) ??
      status(404, { error: 'not_found', message: 'event not found' }),
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: EventModel.eventDetail, 404: ErrorResponse },
    },
  )
  .get(
    '/api/events/:id/ticket-types',
    async ({ params, status }) => {
      const found = await EventService.get(params.id)
      return found?.ticketTypes ?? status(404, { error: 'not_found', message: 'event not found' })
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: t.Array(EventModel.ticketType), 404: ErrorResponse },
    },
  )
  .get(
    '/api/events/:id/images',
    async ({ params, status }) =>
      (await EventService.images(params.id)) ??
      status(404, { error: 'not_found', message: 'event not found' }),
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: t.Array(EventModel.eventImage), 404: ErrorResponse },
    },
  )
  .get(
    '/internal/events/:id/checkout-summary',
    async ({ params, headers, status }) => {
      if (!internalTokenMatches(headers['x-eventide-internal-token'], env.INTERNAL_SERVICE_TOKEN))
        return status(401, { error: 'unauthorized', message: 'invalid internal token' })
      return (
        (await EventService.checkoutSummary(params.id)) ??
        status(404, { error: 'not_found', message: 'event not found' })
      )
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: EventModel.checkoutSummary, 401: ErrorResponse, 404: ErrorResponse },
    },
  )
  .post(
    '/api/events',
    async ({ body, user }) => {
      try {
        return await EventService.create(body, user)
      } catch (err) {
        return error(err)
      }
    },
    {
      auth: true,
      body: EventModel.eventInput,
    },
  )
  .patch(
    '/api/events/:id',
    async ({ params, body, user }) => {
      try {
        return await EventService.update(params.id, body, user)
      } catch (err) {
        return error(err)
      }
    },
    {
      auth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: EventModel.eventInput,
    },
  )
  .post(
    '/api/events/:id/publish',
    async ({ params, user }) => {
      try {
        return await EventService.transition(params.id, 'PUBLISHED', user)
      } catch (err) {
        return error(err)
      }
    },
    { auth: true, params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
  .post(
    '/api/events/:id/close',
    async ({ params, user }) => {
      try {
        return await EventService.transition(params.id, 'CLOSED', user)
      } catch (err) {
        return error(err)
      }
    },
    { auth: true, params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
  .post(
    '/api/admin/events/:id/suspend',
    async ({ params, user }) => {
      try {
        return await EventService.transition(params.id, 'SUSPENDED', user)
      } catch (err) {
        return error(err)
      }
    },
    { auth: true, params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
  .post(
    '/api/ticket-types',
    async ({ body, user }) => {
      try {
        return await EventService.createTicketType(body, user)
      } catch (err) {
        return error(err)
      }
    },
    { auth: true, body: EventModel.ticketTypeInput },
  )
  .post(
    '/api/events/:id/images/presign',
    async ({ params, body, user }) => {
      try {
        return await EventService.prepareImageUpload(
          params.id,
          user,
          body.contentType,
          body.altText,
          body.append,
        )
      } catch (err) {
        return error(err)
      }
    },
    {
      auth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: EventModel.coverUploadBody,
    },
  )
  .patch(
    '/api/events/:id/images/reorder',
    async ({ params, body, user }) => {
      try {
        return await EventService.reorderImages(params.id, body.imageIds, user)
      } catch (err) {
        return error(err)
      }
    },
    {
      auth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: EventModel.imageOrder,
    },
  )
  .delete(
    '/api/events/:id/images/:imageId',
    async ({ params, user }) => {
      try {
        await EventService.deleteImage(params.id, params.imageId, user)
        return { ok: true }
      } catch (err) {
        return error(err)
      }
    },
    {
      auth: true,
      params: t.Object({
        id: t.String({ format: 'uuid' }),
        imageId: t.String({ format: 'uuid' }),
      }),
    },
  )
