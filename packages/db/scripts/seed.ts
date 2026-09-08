import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { user as authUsers } from '../src/auth/schema.ts'
import { categories, eventImages, events, ticketTypes, venues } from '../src/event/schema.ts'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3000'
const EVENT_URL = process.env.EVENT_URL ?? 'http://localhost:3001'
const REGISTRATION_URL = process.env.REGISTRATION_URL ?? 'http://localhost:3002'
const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://localhost:3003'
const AUTH_DATABASE_URL =
  process.env.AUTH_DATABASE_URL ?? 'postgres://auth_svc:auth_svc@localhost:5432/auth_db'
const EVENT_DATABASE_URL =
  process.env.EVENT_DATABASE_URL ?? 'postgres://event_svc:event_svc@localhost:5432/event_db'
const PASSWORD = 'seed-password-123'
const THUMBNAIL = Bun.file(new URL('../assets/eventide-seed-thumbnail.webp', import.meta.url))
const EVENT_TITLES = ['Cloud Native Bangkok', 'Kubernetes Workshop', 'React Community Night']

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
type SeedEvent = { id: string; title: string; ticketTypeId: string }

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

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

async function seedThumbnails(seededEvents: SeedEvent[], token: string) {
  const health = await fetch(`${EVENT_URL}/health/live`).catch(() => null)
  if (!health?.ok) {
    console.warn('event service is unavailable; thumbnail uploads skipped')
    return
  }

  const bytes = await THUMBNAIL.arrayBuffer()
  for (const event of seededEvents) {
    const prepared = await fetch(`${EVENT_URL}/api/events/${event.id}/images/presign`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contentType: 'image/webp',
        altText: `${event.title} event cover`,
      }),
    })
    if (prepared.status === 501) {
      console.warn('event image storage is unavailable; thumbnail uploads skipped')
      return
    }
    if (!prepared.ok) {
      console.warn(`thumbnail preparation failed for ${event.title}: ${prepared.status}`)
      continue
    }

    const upload = (await prepared.json()) as { uploadUrl: string; imageId: string }
    const uploaded = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/webp' },
      body: bytes,
    })
    if (!uploaded.ok) {
      console.warn(`thumbnail upload failed for ${event.title}: ${uploaded.status}`)
      await fetch(`${EVENT_URL}/api/events/${event.id}/images/${upload.imageId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => null)
    }
  }
}

async function main() {
  const health = await fetch(`${AUTH_URL}/health/live`).catch(() => null)
  if (!health?.ok) throw new Error(`auth service is not reachable at ${AUTH_URL}`)

  const authSql = postgres(AUTH_DATABASE_URL, { max: 1 })
  const authDb = drizzle(authSql, { schema: { authUsers } })
  const people = new Map<string, SeedUser>()
  try {
    for (const person of PEOPLE) {
      await authDb
        .update(authUsers)
        .set({ banned: false, banReason: null, banExpires: null })
        .where(eq(authUsers.email, person.email))
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

  const organizer = required(people.get('somchai@eventide.test'), 'seed organizer is missing')
  const eventSql = postgres(EVENT_DATABASE_URL, { max: 1 })
  const eventDb = drizzle(eventSql, {
    schema: { categories, venues, events, ticketTypes, eventImages },
  })
  const seededEvents: SeedEvent[] = []
  try {
    if (process.env.SEED_FORCE) await eventDb.delete(events)
    const now = Date.now()
    const eventSpecs = Array.from({ length: 12 }, (_, index) => ({
      title: `${EVENT_TITLES[index % EVENT_TITLES.length]} #${index + 1}`,
      status: index === 11 ? ('DRAFT' as const) : ('PUBLISHED' as const),
      startsAt: new Date(now + (index + 3) * 86_400_000),
      endsAt: new Date(now + (index + 3) * 86_400_000 + 10_800_000),
      salesStartAt: new Date(now - 86_400_000),
      salesEndAt: new Date(now + (index + 2) * 86_400_000),
      price: index % 4 === 0 ? '0.00' : '500.00',
    }))
    const existing = await eventDb
      .select()
      .from(events)
      .where(
        and(
          eq(events.ownerId, organizer.id),
          inArray(
            events.title,
            eventSpecs.map((event) => event.title),
          ),
        ),
      )
    const existingByTitle = new Map(existing.map((event) => [event.title, event]))
    const category = required(
      (
        await eventDb
          .insert(categories)
          .values({ name: 'Technology', slug: 'technology' })
          .onConflictDoUpdate({ target: categories.slug, set: { name: 'Technology' } })
          .returning()
      )[0],
      'category insert returned no row',
    )
    const venue =
      (
        await eventDb
          .select()
          .from(venues)
          .where(and(eq(venues.name, 'KMITL Auditorium'), eq(venues.address, 'Lat Krabang')))
          .limit(1)
      )[0] ??
      required(
        (
          await eventDb
            .insert(venues)
            .values({
              name: 'KMITL Auditorium',
              address: 'Lat Krabang',
              province: 'Bangkok',
              capacity: 500,
            })
            .returning()
        )[0],
        'venue insert returned no row',
      )

    for (const spec of eventSpecs) {
      const event =
        existingByTitle.get(spec.title) ??
        required(
          (
            await eventDb
              .insert(events)
              .values({
                categoryId: category.id,
                venueId: venue.id,
                ownerId: organizer.id,
                title: spec.title,
                description: 'A seeded Eventide demonstration event.',
                status: spec.status,
                startsAt: spec.startsAt,
                endsAt: spec.endsAt,
                salesStartAt: spec.salesStartAt,
                salesEndAt: spec.salesEndAt,
                capacity: 100,
              })
              .returning()
          )[0],
          'event insert returned no row',
        )
      const type = required(
        (
          await eventDb
            .insert(ticketTypes)
            .values({
              eventId: event.id,
              name: 'General admission',
              price: spec.price,
              quota: 100,
              maxPerOrder: 4,
              maxPerUser: 20,
            })
            .onConflictDoUpdate({
              target: [ticketTypes.eventId, ticketTypes.name],
              set: { maxPerUser: 20 },
            })
            .returning()
        )[0],
        'ticket type insert returned no row',
      )
      await eventDb
        .insert(eventImages)
        .values({
          eventId: event.id,
          objectKey: `/seed/eventide-seed-thumbnail.webp?event=${event.id}`,
          altText: `${event.title} event cover`,
          position: 0,
        })
        .onConflictDoNothing()
      seededEvents.push({ id: event.id, title: event.title, ticketTypeId: type.id })
    }
  } finally {
    await eventSql.end()
  }

  await seedThumbnails(seededEvents, await jwt(organizer.sessionToken))

  const registrationHealth = await fetch(`${REGISTRATION_URL}/health/live`).catch(() => null)
  const paymentHealth = await fetch(`${PAYMENT_URL}/health/live`).catch(() => null)
  if (!registrationHealth?.ok || !paymentHealth?.ok) {
    console.warn(
      'registration/payment is unavailable; users and catalog were seeded, purchases skipped',
    )
    return
  }
  for (const [index, email] of ['priya@eventide.test', 'tom@eventide.test'].entries()) {
    const person = required(people.get(email), `seed attendee is missing: ${email}`)
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
