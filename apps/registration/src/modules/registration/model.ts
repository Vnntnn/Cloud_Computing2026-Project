import { t } from 'elysia'

const money = t.String({ pattern: '^\\d+(\\.\\d{2})$' })
const orderStatus = t.Union([
  t.Literal('PENDING'),
  t.Literal('CONFIRMED'),
  t.Literal('CANCELLED'),
  t.Literal('EXPIRED'),
  t.Literal('PENDING_VERIFICATION'),
  t.Literal('REFUNDED'),
])

const orderItem = t.Object({
  id: t.String({ format: 'uuid' }),
  ticketTypeId: t.String({ format: 'uuid' }),
  ticketTypeName: t.String(),
  unitPrice: money,
  quantity: t.Integer(),
  lineTotal: money,
})
const order = t.Object({
  id: t.String({ format: 'uuid' }),
  userId: t.String(),
  eventId: t.String({ format: 'uuid' }),
  eventTitle: t.String(),
  status: orderStatus,
  currency: t.Literal('THB'),
  refundPercent: t.Integer(),
  subtotal: money,
  total: money,
  expiresAt: t.String({ format: 'date-time' }),
  confirmedAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
  cancelledAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
  createdAt: t.String({ format: 'date-time' }),
  items: t.Array(orderItem),
})
const ticket = t.Object({
  id: t.String({ format: 'uuid' }),
  orderId: t.String({ format: 'uuid' }),
  eventId: t.String({ format: 'uuid' }),
  ticketTypeId: t.String({ format: 'uuid' }),
  eventTitle: t.String(),
  ticketTypeName: t.String(),
  status: t.Union([
    t.Literal('VALID'),
    t.Literal('USED'),
    t.Literal('CANCELLED'),
    t.Literal('REFUNDED'),
  ]),
  issuedAt: t.String({ format: 'date-time' }),
  qrToken: t.String(),
})

export const RegistrationModel = {
  createOrder: t.Object({
    eventId: t.String({ format: 'uuid' }),
    items: t.Array(
      t.Object({
        ticketTypeId: t.String({ format: 'uuid' }),
        quantity: t.Integer({ minimum: 1, maximum: 20 }),
      }),
      { minItems: 1, maxItems: 10 },
    ),
  }),
  order,
  orderList: t.Array(order),
  ticket,
  ticketList: t.Array(ticket),
  confirm: t.Object({ paymentId: t.String({ format: 'uuid' }) }),
  paymentOrder: t.Object({
    id: t.String({ format: 'uuid' }),
    userId: t.String(),
    status: orderStatus,
    total: money,
    currency: t.Literal('THB'),
    refundPercent: t.Integer(),
    expiresAt: t.String({ format: 'date-time' }),
  }),
  checkIn: t.Object({
    eventId: t.String({ format: 'uuid' }),
    qrToken: t.String({ minLength: 20 }),
  }),
  salesSummary: t.Object({
    eventId: t.String({ format: 'uuid' }),
    totalOrders: t.Integer(),
    pendingOrders: t.Integer(),
    confirmedOrders: t.Integer(),
    refundedOrders: t.Integer(),
    totalQuota: t.Integer(),
    reservedTickets: t.Integer(),
    soldTickets: t.Integer(),
    successfulCheckIns: t.Integer(),
    netRevenue: money,
  }),
}

export type CreateOrder = typeof RegistrationModel.createOrder.static
