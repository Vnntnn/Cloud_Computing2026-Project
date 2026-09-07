import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { user as authUsers } from '../src/auth/schema.ts'
import { categories, events, ticketTypes, venues } from '../src/event/schema.ts'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3000'
const REGISTRATION_URL = process.env.REGISTRATION_URL ?? 'http://localhost:3002'
const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://localhost:3003'
const AUTH_DATABASE_URL =
  process.env.AUTH_DATABASE_URL ?? 'postgres://auth_svc:auth_svc@localhost:5432/auth_db'
const EVENT_DATABASE_URL =
  process.env.EVENT_DATABASE_URL ?? 'postgres://event_svc:event_svc@localhost:5432/event_db'
const PASSWORD = 'seed-password-123'

const PEOPLE = [
  { name: 'Eventide Admin', email: 'admin@eventide.test', role: 'admin', approval: 'NOT_APPLIED' },
  {
    name: 'Somchai Pattana',
    email: 'somchai@eventide.test',
    role: 'organizer',
    approval: 'APPROVED',
  },
  { name: 'Nadia Okafor', email: 'nadia@eventide.test', role: 'organizer', approval: 'APPROVED' },
  {
    name: 'Pending Organizer',
    email: 'pending@eventide.test',
    role: 'attendee',
    approval: 'PENDING',
  },
  { name: 'Priya Sharma', email: 'priya@eventide.test', role: 'attendee', approval: 'NOT_APPLIED' },
  { name: 'Tom Becker', email: 'tom@eventide.test', role: 'attendee', approval: 'NOT_APPLIED' },
  {
    name: 'Banned Demo',
    email: 'banned@eventide.test',
    role: 'attendee',
    approval: 'NOT_APPLIED',
    banned: true,
  },
] as const

type SeedUser = { id: string; email: string; sessionToken: string }
async function ensureUser(name: string, email: string): Promise<SeedUser> {
  let response = await fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: PASSWORD }),
  })
  if (!response.ok)
    response = await fetch(`${AUTH_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
  if (!response.ok)
    throw new Error(`cannot seed ${email}: ${response.status} ${await response.text()}`)
  const body = (await response.json()) as { user: { id: string; email: string } }
  return { ...body.user, sessionToken: response.headers.get('set-auth-token') ?? '' }
}

async function jwt(sessionToken: string) {
  const response = await fetch(`${AUTH_URL}/api/auth/token`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  })
  if (!response.ok) throw new Error(`token exchange failed: ${response.status}`)
  return ((await response.json()) as { token: string }).token
}

async function main() {
  const health = await fetch(`${AUTH_URL}/health/live`).catch(() => null)
  if (!health?.ok) throw new Error(`auth service is not reachable at ${AUTH_URL}`)

  const authSql = postgres(AUTH_DATABASE_URL, { max: 1 })
  const authDb = drizzle(authSql, { schema: { authUsers } })
  const people = new Map<string, SeedUser>()
  try {
    for (const person of PEOPLE) {
      const seeded = await ensureUser(person.name, person.email)
      people.set(person.email, seeded)
      await authDb
        .update(authUsers)
        .set({
          role: person.role,
          organizerApprovalStatus: person.approval,
          organizerApprovedAt: person.approval === 'APPROVED' ? new Date() : null,
          banned: 'banned' in person ? person.banned : false,
          banReason: 'banned' in person ? 'Demo moderation state' : null,
        })
        .where(eq(authUsers.id, seeded.id))
    }
  } finally {
    await authSql.end()
  }

  const eventSql = postgres(EVENT_DATABASE_URL, { max: 1 })
  const eventDb = drizzle(eventSql, { schema: { categories, venues, events, ticketTypes } })
  let seededEvents: Array<{ id: string; ticketTypeId: string }> = []
  try {
    if (process.env.SEED_FORCE) await eventDb.delete(events)
    const existing = await eventDb.select({ id: events.id }).from(events).limit(1)
    if (!existing.length) {
      const [category] = await eventDb
        .insert(categories)
        .values({ name: 'Technology', slug: 'technology' })
        .onConflictDoUpdate({ target: categories.slug, set: { name: 'Technology' } })
        .returning()
      const [venue] = await eventDb
        .insert(venues)
        .values({
          name: 'KMITL Auditorium',
          address: 'Lat Krabang',
          province: 'Bangkok',
          capacity: 500,
        })
        .returning()
      const ownerId = people.get('somchai@eventide.test')!.id
      const now = Date.now()
      for (let index = 0; index < 12; index++) {
        const [event] = await eventDb
          .insert(events)
          .values({
            categoryId: category!.id,
            venueId: venue!.id,
            ownerId,
            title:
              ['Cloud Native Bangkok', 'Kubernetes Workshop', 'React Community Night'][index % 3] +
              ` #${index + 1}`,
            description: 'A seeded Eventide demonstration event.',
            status: index === 11 ? 'DRAFT' : 'PUBLISHED',
            startsAt: new Date(now + (index + 3) * 86_400_000),
            endsAt: new Date(now + (index + 3) * 86_400_000 + 10_800_000),
            salesStartAt: new Date(now - 86_400_000),
            salesEndAt: new Date(now + (index + 2) * 86_400_000),
            capacity: 100,
          })
          .returning()
        const [type] = await eventDb
          .insert(ticketTypes)
          .values({
            eventId: event!.id,
            name: 'General admission',
            price: index % 4 === 0 ? '0.00' : '500.00',
            quota: 100,
            maxPerOrder: 4,
          })
          .returning()
        seededEvents.push({ id: event!.id, ticketTypeId: type!.id })
      }
    } else {
      seededEvents = await eventDb
        .select({ id: events.id, ticketTypeId: ticketTypes.id })
        .from(events)
        .innerJoin(ticketTypes, eq(ticketTypes.eventId, events.id))
    }
  } finally {
    await eventSql.end()
  }

  const registrationHealth = await fetch(`${REGISTRATION_URL}/health/live`).catch(() => null)
  const paymentHealth = await fetch(`${PAYMENT_URL}/health/live`).catch(() => null)
  if (!registrationHealth?.ok || !paymentHealth?.ok) {
    console.warn(
      'registration/payment is unavailable; users and catalog were seeded, purchases skipped',
    )
    return
  }
  for (const [index, email] of ['priya@eventide.test', 'tom@eventide.test'].entries()) {
    const person = people.get(email)!
    const token = await jwt(person.sessionToken)
    const target = seededEvents[index]
    if (!target) continue
    const orderKey = `seed-order-${email}-${target.id}`
    const orderResponse = await fetch(`${REGISTRATION_URL}/api/orders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': orderKey,
      },
      body: JSON.stringify({
        eventId: target.id,
        items: [{ ticketTypeId: target.ticketTypeId, quantity: index + 1 }],
      }),
    })
    if (!orderResponse.ok) {
      console.warn(`order seed failed: ${orderResponse.status}`)
      continue
    }
    const order = (await orderResponse.json()) as { id: string }
    await fetch(`${PAYMENT_URL}/api/payments/checkout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': `seed-payment-${order.id}`,
      },
      body: JSON.stringify({ orderId: order.id }),
    })
  }
}

await main()
console.log('seed complete — password for all demo users:', PASSWORD)
