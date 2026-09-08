/**
 * End-to-end persona smoke test. Assumes the four services are up (`make dev`)
 * and `make seed` has run (for the admin + approved-organizer accounts).
 *
 *   make smoke            # against localhost
 *   BASE_AUTH=… BASE_EVENT=… BASE_REG=… BASE_PAY=… bun scripts/smoke.ts
 *
 * Exits non-zero on the first failed assertion. Used by the CI `e2e` job.
 */
const AUTH = process.env.BASE_AUTH ?? 'http://localhost:3000'
const EVENT = process.env.BASE_EVENT ?? 'http://localhost:3001'
const REG = process.env.BASE_REG ?? 'http://localhost:3002'
const PAY = process.env.BASE_PAY ?? 'http://localhost:3003'
const PASSWORD = 'seed-password-123'

let checks = 0
function assert(cond: unknown, msg: string): asserts cond {
  checks++
  if (!cond) throw new Error(`✗ ${msg}`)
  console.log(`✓ ${msg}`)
}

type Json = Record<string, any>
async function api(
  base: string,
  path: string,
  init: RequestInit & { token?: string; idempotencyKey?: string } = {},
): Promise<{ status: number; body: Json }> {
  const { token, idempotencyKey, ...rest } = init
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      ...rest.headers,
    },
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}

/**
 * Auth-service endpoints (`/api/users/*`, `/api/admin/*`) resolve the
 * better-auth *session* token; the cross-service JWT (`session.jwt`) is what
 * event/registration/payment verify against the JWKS.
 */
interface Principal {
  session: string
  jwt: string
}

async function principalFrom(res: Response, label: string): Promise<Principal> {
  const session = res.headers.get('set-auth-token')
  assert(res.ok && session, label)
  const jwt = await fetch(`${AUTH}/api/auth/token`, {
    headers: { authorization: `Bearer ${session}` },
  })
  return { session: session!, jwt: ((await jwt.json()) as { token: string }).token }
}

const signIn = (email: string) =>
  fetch(`${AUTH}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  }).then((r) => principalFrom(r, `sign in ${email}`))

const signUp = (email: string) =>
  fetch(`${AUTH}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: email, email, password: PASSWORD }),
  }).then((r) => principalFrom(r, `sign up ${email}`))

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
const subOf = (jwt: string): string =>
  JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).sub

async function main() {
  for (const p of [
    [AUTH, 'auth'],
    [EVENT, 'event'],
    [REG, 'registration'],
    [PAY, 'payment'],
  ] as const) {
    const r = await fetch(`${p[0]}/health/ready`).catch(() => null)
    assert(r?.ok, `${p[1]} is up`)
  }

  const admin = await signIn('admin@eventide.test')
  const organizer = await signIn('somchai@eventide.test')
  const attendee = await signUp(`smoke-${crypto.randomUUID()}@test.eventide`)

  // --- organizer: create + publish an event -------------------------------
  const created = await api(EVENT, '/api/events', {
    method: 'POST',
    token: organizer.jwt,
    body: JSON.stringify({
      title: `Smoke Event ${Date.now()}`,
      startsAt: iso(3 * 86_400_000),
      endsAt: iso(3 * 86_400_000 + 3 * 3_600_000),
      salesStartAt: iso(-3_600_000),
      salesEndAt: iso(2 * 86_400_000),
      capacity: 100,
    }),
  })
  assert(created.status === 200 && created.body.id, 'organizer creates a draft event')
  const eventId: string = created.body.id

  const tt = await api(EVENT, '/api/ticket-types', {
    method: 'POST',
    token: organizer.jwt,
    body: JSON.stringify({ eventId, name: 'General', price: '500.00', quota: 3, maxPerOrder: 4 }),
  })
  assert(tt.status === 200 && tt.body.id, 'organizer adds a ticket type')
  const ticketTypeId: string = tt.body.id

  const published = await api(EVENT, `/api/events/${eventId}/publish`, {
    method: 'POST',
    token: organizer.jwt,
  })
  assert(published.status === 200, 'organizer publishes the event')

  const listed = await api(EVENT, '/api/events?page=1&pageSize=100')
  assert(
    listed.body.items?.some((e: Json) => e.id === eventId),
    'published event appears in the public list',
  )

  // --- attendee: buy a ticket -------------------------------------------
  const idem = crypto.randomUUID()
  const orderReq = {
    method: 'POST',
    token: attendee.jwt,
    idempotencyKey: idem,
    body: JSON.stringify({ eventId, items: [{ ticketTypeId, quantity: 2 }] }),
  }
  const order = await api(REG, '/api/orders', orderReq)
  assert(
    order.status === 200 && order.body.status === 'PENDING',
    'attendee creates a PENDING order',
  )
  assert(order.body.total === '1000.00', 'order total is server-calculated (2 × 500.00)')
  const orderId: string = order.body.id

  const replay = await api(REG, '/api/orders', orderReq)
  assert(replay.body.id === orderId, 'a repeated Idempotency-Key returns the same order')

  const pay = await api(PAY, '/api/payments/checkout', {
    method: 'POST',
    token: attendee.jwt,
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({ orderId }),
  })
  assert(pay.status === 200 && pay.body.status === 'SUCCEEDED', 'mock payment succeeds')

  const confirmed = await api(REG, `/api/orders/${orderId}`, { token: attendee.jwt })
  assert(confirmed.body.status === 'CONFIRMED', 'order is CONFIRMED after payment')

  const tickets = await api(REG, '/api/tickets/me', { token: attendee.jwt })
  const mine = (tickets.body as unknown as Json[]).filter((t) => t.eventId === eventId)
  assert(mine.length === 2, 'two tickets were issued')
  const qrToken: string = mine[0]!.qrToken
  assert(typeof qrToken === 'string' && qrToken.length > 20, 'ticket carries a signed QR token')

  // --- sold out: the 4th ticket cannot be reserved ----------------------
  const other = await signUp(`smoke-so-${crypto.randomUUID()}@test.eventide`)
  const soldOut = await api(REG, '/api/orders', {
    method: 'POST',
    token: other.jwt,
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({ eventId, items: [{ ticketTypeId, quantity: 2 }] }),
  })
  assert(
    soldOut.status === 409 && soldOut.body.error === 'capacity_full',
    'sold-out returns 409 capacity_full',
  )

  // --- organizer: check-in ---------------------------------------------
  const scan1 = await api(REG, '/api/check-ins', {
    method: 'POST',
    token: organizer.jwt,
    body: JSON.stringify({ eventId, qrToken }),
  })
  assert(scan1.body.result === 'SUCCESS', 'first scan of a ticket is SUCCESS')
  const scan2 = await api(REG, '/api/check-ins', {
    method: 'POST',
    token: organizer.jwt,
    body: JSON.stringify({ eventId, qrToken }),
  })
  assert(scan2.body.result === 'DUPLICATE', 'second scan of the same ticket is DUPLICATE')

  // --- admin: moderation + audit + payment reconciliation views --------
  const suspend = await api(EVENT, `/api/admin/events/${eventId}/suspend`, {
    method: 'POST',
    token: admin.jwt,
  })
  assert(suspend.status === 200, 'admin suspends the event')
  const afterSuspend = await api(EVENT, '/api/events?page=1&pageSize=100')
  assert(
    !afterSuspend.body.items?.some((e: Json) => e.id === eventId),
    'a suspended event drops out of the public list',
  )

  const ban = await api(AUTH, `/api/admin/users/${subOf(other.jwt)}/ban`, {
    method: 'POST',
    token: admin.session,
    body: JSON.stringify({ reason: 'smoke-test moderation' }),
  })
  assert(ban.status === 200 && ban.body.banned === true, 'admin bans a user')

  const audit = await api(AUTH, '/api/admin/audit-logs', { token: admin.session })
  assert(
    Array.isArray(audit.body) && audit.body.some((l: Json) => l.action === 'USER_BANNED'),
    'the ban is recorded in the audit log',
  )

  const paymentsView = await api(PAY, '/api/payments/admin', { token: admin.jwt })
  assert(
    (paymentsView.body as unknown as Json[]).some((p) => p.orderId === orderId),
    'admin payment view lists the order payment',
  )

  console.log(`\n${checks} checks passed — persona smoke OK`)
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
