import { bearerAuth } from '@eventide/shared/auth'
import { ErrorResponse } from '@eventide/shared/models'
import { Elysia, t } from 'elysia'
import { env } from '../../env.ts'
import { PaymentModel } from './model.ts'
import { PaymentForbidden, PaymentInvalid, PaymentNotFound, PaymentService } from './service.ts'

function mapError(err: unknown) {
  const response = (status: number, body: { error: string; message: string }) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (err instanceof PaymentForbidden)
    return response(403, { error: 'forbidden', message: 'payment does not belong to this user' })
  if (err instanceof PaymentNotFound)
    return response(404, { error: 'not_found', message: 'payment not found' })
  if (err instanceof PaymentInvalid)
    return response(409, { error: 'invalid_payment', message: err.message })
  throw err
}

export const payment = new Elysia({ prefix: '/api/payments', tags: ['payments'] })
  .use(
    bearerAuth({
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_BASE_URL,
      audience: env.AUTH_BASE_URL,
    }),
  )
  .model(PaymentModel)
  .post(
    '/checkout',
    async ({ body, user, headers, status }) => {
      const key = headers['idempotency-key']
      if (!key)
        return status(400, {
          error: 'idempotency_required',
          message: 'Idempotency-Key header is required',
        })
      try {
        return await PaymentService.checkout(body.orderId, user.id, key)
      } catch (err) {
        return mapError(err)
      }
    },
    { auth: true, body: PaymentModel.checkout },
  )
  .get(
    '/order/:orderId',
    async ({ params, user }) => {
      try {
        return await PaymentService.forOrder(params.orderId, user.id)
      } catch (err) {
        return mapError(err)
      }
    },
    { auth: true, params: t.Object({ orderId: t.String({ format: 'uuid' }) }) },
  )
  .get(
    '/admin',
    ({ query, user, status }) => {
      if (user.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'admin role required' })
      return PaymentService.list(query.status)
    },
    {
      auth: true,
      query: t.Object({
        status: t.Optional(
          t.Union([
            t.Literal('PROCESSING'),
            t.Literal('SUCCEEDED'),
            t.Literal('PENDING_VERIFICATION'),
            t.Literal('FAILED'),
            t.Literal('REFUNDED'),
          ]),
        ),
      }),
    },
  )
  .post(
    '/:id/reconcile',
    async ({ params, user, status }) => {
      if (user.role !== 'admin')
        return status(403, { error: 'forbidden', message: 'admin role required' })
      try {
        return await PaymentService.reconcile(params.id)
      } catch (err) {
        return mapError(err)
      }
    },
    { auth: true, params: t.Object({ id: t.String({ format: 'uuid' }) }) },
  )
  .post(
    '/order/:orderId/refund',
    async ({ params, user }) => {
      try {
        return await PaymentService.refund(params.orderId, user.id)
      } catch (err) {
        return mapError(err)
      }
    },
    { auth: true, params: t.Object({ orderId: t.String({ format: 'uuid' }) }) },
  )
