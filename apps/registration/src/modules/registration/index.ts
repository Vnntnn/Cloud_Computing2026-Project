import { bearerAuth } from '@eventide/shared/auth'
import { internalTokenMatches } from '@eventide/shared/internal'
import { ErrorResponse } from '@eventide/shared/models'
import { Elysia, t } from 'elysia'
import { env } from '../../env.ts'
import {
  EventNotFound,
  EventServiceUnavailable,
  fetchCheckoutSummary,
} from '../../lib/event-client.ts'
import { RegistrationModel } from './model.ts'
import { CapacityFull, InvalidOrder, OrderNotFound, RegistrationService } from './service.ts'

export const registration = new Elysia({ tags: ['orders'] })
  .use(
    bearerAuth({
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_BASE_URL,
      audience: env.AUTH_BASE_URL,
    }),
  )
  .model(RegistrationModel)
  .post(
    '/api/orders',
    async ({ body, user, headers, status }) => {
      const key = headers['idempotency-key']
      if (!key)
        return status(400, {
          error: 'idempotency_required',
          message: 'Idempotency-Key header is required',
        })
      try {
        return await RegistrationService.create(body, user.id, key)
      } catch (err) {
        if (err instanceof EventNotFound)
          return status(404, { error: 'event_not_found', message: err.message })
        if (err instanceof CapacityFull)
          return status(409, {
            error: 'capacity_full',
            message: 'requested inventory is unavailable',
          })
        if (err instanceof InvalidOrder)
          return status(409, { error: 'invalid_order', message: err.message })
        if (err instanceof EventServiceUnavailable)
          return status(502, { error: 'event_unavailable', message: err.message })
        throw err
      }
    },
    {
      auth: true,
      body: RegistrationModel.createOrder,
      response: {
        200: RegistrationModel.order,
        400: ErrorResponse,
        401: ErrorResponse,
        404: ErrorResponse,
        409: ErrorResponse,
        502: ErrorResponse,
      },
    },
  )
  .get('/api/orders/me', ({ user }) => RegistrationService.mine(user.id), {
    auth: true,
    response: { 200: RegistrationModel.orderList, 401: ErrorResponse },
  })
  .get(
    '/api/orders/:id',
    async ({ params, user, status }) =>
      (await RegistrationService.get(params.id, user.id)) ??
      status(404, { error: 'not_found', message: 'order not found' }),
    {
      auth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: RegistrationModel.order, 401: ErrorResponse, 404: ErrorResponse },
    },
  )
  .post(
    '/api/orders/:id/cancel',
    async ({ params, user, status }) => {
      try {
        return await RegistrationService.cancel(params.id, user.id)
      } catch (err) {
        if (err instanceof OrderNotFound)
          return status(404, { error: 'not_found', message: 'order not found' })
        if (err instanceof InvalidOrder)
          return status(409, { error: 'invalid_order', message: err.message })
        throw err
      }
    },
    { auth: true, params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
  .get('/api/tickets/me', ({ user }) => RegistrationService.tickets(user.id), {
    auth: true,
    response: { 200: RegistrationModel.ticketList, 401: ErrorResponse },
  })
  .get(
    '/api/tickets/:id',
    async ({ params, user, status }) =>
      (await RegistrationService.ticket(params.id, user.id)) ??
      status(404, { error: 'not_found', message: 'ticket not found' }),
    {
      auth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: RegistrationModel.ticket, 401: ErrorResponse, 404: ErrorResponse },
    },
  )
  .post(
    '/api/check-ins',
    async ({ body, user, status }) => {
      if (user.role !== 'organizer' && user.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'organizer role required' })
      if (user.role === 'organizer' && user.organizerApprovalStatus !== 'APPROVED')
        return status(403, { error: 'forbidden', message: 'organizer approval required' })
      try {
        const event = await fetchCheckoutSummary(body.eventId)
        if (user.role !== 'admin' && event.ownerId !== user.id)
          return status(403, { error: 'forbidden', message: 'event ownership required' })
        return RegistrationService.checkIn(body.qrToken, body.eventId, user.id)
      } catch (err) {
        if (err instanceof EventNotFound)
          return status(404, { error: 'event_not_found', message: err.message })
        if (err instanceof EventServiceUnavailable)
          return status(502, { error: 'event_unavailable', message: err.message })
        throw err
      }
    },
    { auth: true, body: RegistrationModel.checkIn },
  )
  .get(
    '/api/check-ins/events/:id',
    async ({ params, user, status }) => {
      if (user.role !== 'organizer' && user.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'organizer role required' })
      try {
        const event = await fetchCheckoutSummary(params.id)
        if (user.role !== 'admin' && event.ownerId !== user.id)
          return status(403, { error: 'forbidden', message: 'event ownership required' })
        return RegistrationService.checkIns(params.id)
      } catch (err) {
        if (err instanceof EventNotFound)
          return status(404, { error: 'event_not_found', message: err.message })
        if (err instanceof EventServiceUnavailable)
          return status(502, { error: 'event_unavailable', message: err.message })
        throw err
      }
    },
    { auth: true, params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
  .get(
    '/internal/orders/:id',
    async ({ params, headers, status }) => {
      if (!internalTokenMatches(headers['x-eventide-internal-token'], env.INTERNAL_SERVICE_TOKEN))
        return status(401, { error: 'unauthorized', message: 'invalid internal token' })
      try {
        return await RegistrationService.paymentOrder(params.id)
      } catch (err) {
        if (err instanceof OrderNotFound)
          return status(404, { error: 'not_found', message: 'order not found' })
        throw err
      }
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: RegistrationModel.paymentOrder, 401: ErrorResponse, 404: ErrorResponse },
    },
  )
  .post(
    '/internal/orders/:id/confirm',
    async ({ params, body, headers, status }) => {
      if (!internalTokenMatches(headers['x-eventide-internal-token'], env.INTERNAL_SERVICE_TOKEN))
        return status(401, { error: 'unauthorized', message: 'invalid internal token' })
      try {
        return await RegistrationService.confirm(params.id, body.paymentId)
      } catch (err) {
        if (err instanceof OrderNotFound)
          return status(404, { error: 'not_found', message: 'order not found' })
        if (err instanceof InvalidOrder)
          return status(409, { error: 'invalid_order', message: err.message })
        throw err
      }
    },
    { params: t.Object({ id: t.String({ format: 'uuid' }) }), body: RegistrationModel.confirm },
  )
  .post(
    '/internal/orders/:id/pending-verification',
    async ({ params, headers, status }) => {
      if (!internalTokenMatches(headers['x-eventide-internal-token'], env.INTERNAL_SERVICE_TOKEN))
        return status(401, { error: 'unauthorized', message: 'invalid internal token' })
      await RegistrationService.markPendingVerification(params.id)
      return { ok: true }
    },
    { params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
  .post(
    '/internal/orders/:id/refund',
    async ({ params, headers, status }) => {
      if (!internalTokenMatches(headers['x-eventide-internal-token'], env.INTERNAL_SERVICE_TOKEN))
        return status(401, { error: 'unauthorized', message: 'invalid internal token' })
      try {
        await RegistrationService.refund(params.id)
        return { ok: true }
      } catch (err) {
        if (err instanceof OrderNotFound)
          return status(404, { error: 'not_found', message: 'order not found' })
        if (err instanceof InvalidOrder)
          return status(409, { error: 'invalid_order', message: err.message })
        throw err
      }
    },
    { params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
