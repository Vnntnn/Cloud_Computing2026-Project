import { t } from 'elysia'

export const PaymentModel = {
  checkout: t.Object({ orderId: t.String({ format: 'uuid' }) }),
  payment: t.Object({
    id: t.String({ format: 'uuid' }),
    orderId: t.String({ format: 'uuid' }),
    status: t.Union([
      t.Literal('PROCESSING'),
      t.Literal('SUCCEEDED'),
      t.Literal('PENDING_VERIFICATION'),
      t.Literal('FAILED'),
      t.Literal('REFUNDED'),
    ]),
    amount: t.String(),
    currency: t.Literal('THB'),
    provider: t.Literal('mock'),
    providerReference: t.Union([t.String(), t.Null()]),
    createdAt: t.String({ format: 'date-time' }),
    updatedAt: t.String({ format: 'date-time' }),
  }),
}
