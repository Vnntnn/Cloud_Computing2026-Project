/**
 * bun test preload (see bunfig.toml). Runs before any test file imports the
 * service `app`, so `src/env.ts` reads the fixture URLs:
 *   - AUTH_JWKS_URL       -> throwaway JWKS endpoint (real bearerAuth guard runs)
 *   - REGISTRATION_SERVICE_URL -> an in-memory stub of registration's /internal API
 *
 * The stub keeps order state in a Map so `checkout` -> `confirm` transitions are
 * observable, and `failConfirm` / `failRefund` let a test force the peer to
 * error (the uncertain-payment paths).
 */
import { fakeService, installAuthFixture } from '@eventide/shared/testing'

await installAuthFixture()

export interface StubOrder {
  id: string
  userId: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'PENDING_VERIFICATION' | 'REFUNDED'
  total: string
  currency: 'THB'
  refundPercent: number
  expiresAt: string
}

const orders = new Map<string, StubOrder>()
let failConfirm = false
let failRefund = false

export function seedOrder(over: Partial<StubOrder> = {}): StubOrder {
  const order: StubOrder = {
    id: crypto.randomUUID(),
    userId: 'buyer',
    status: 'PENDING',
    total: '1000.00',
    currency: 'THB',
    refundPercent: 100,
    expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
    ...over,
  }
  orders.set(order.id, order)
  return order
}

export function setPeerFailure(opts: { confirm?: boolean; refund?: boolean }): void {
  if (opts.confirm !== undefined) failConfirm = opts.confirm
  if (opts.refund !== undefined) failRefund = opts.refund
}

export function resetRegistrationStub(): void {
  orders.clear()
  failConfirm = false
  failRefund = false
}

const registration = fakeService()
process.env.REGISTRATION_SERVICE_URL = registration.url

registration.route(/\/internal\/orders\/([^/]+)\/confirm$/, (m) => {
  if (failConfirm) return new Response('confirm failed', { status: 500 })
  const order = orders.get(m[1]!)
  if (!order) return new Response('not found', { status: 404 })
  order.status = 'CONFIRMED'
  return Response.json({ ok: true })
})
registration.route(/\/internal\/orders\/([^/]+)\/pending-verification$/, () =>
  Response.json({ ok: true }),
)
registration.route(/\/internal\/orders\/([^/]+)\/refund$/, (m) => {
  if (failRefund) return new Response('refund failed', { status: 500 })
  const order = orders.get(m[1]!)
  if (!order) return new Response('not found', { status: 404 })
  order.status = 'REFUNDED'
  return Response.json({ ok: true })
})
registration.route(/\/internal\/orders\/([^/]+)$/, (m) => {
  const order = orders.get(m[1]!)
  return order ? Response.json(order) : new Response('not found', { status: 404 })
})
