/**
 * Demo seed — idempotent. Three phases:
 *   1. organiser accounts, created through the `auth` service (better-auth owns
 *      password hashing and the `user` table — users cannot be raw-inserted,
 *      SYSTEM-DESIGN §5.1.1)
 *   2. ~15 events owned by them, written straight into `event_db`
 *   3. attendee accounts + a spread of booked tickets, created through the
 *      `registration` service so capacity + denormalisation run for real (§4.3)
 *
 * Phase 3 is skipped (with a warning, not an error) if the registration service
 * or its database is unreachable — events are the part the demo can't do without.
 *
 * Runs against the LIVE services: locally after `make dev` is up, in-cluster as
 * a one-off pod after deploy (scripts/seed.sh). Not part of `make bootstrap`.
 *
 *   AUTH_URL                    default http://localhost:3000
 *   REGISTRATION_URL            default http://localhost:3002
 *   EVENT_DATABASE_URL          default postgres://event_svc:event_svc@localhost:5432/event_db
 *   REGISTRATION_DATABASE_URL   default postgres://registration_svc:registration_svc@localhost:5432/registration_db
 *   SEED_FORCE=1                re-seed even if events already exist (also clears tickets)
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { events } from '../src/event/schema.ts'
import { tickets } from '../src/registration/schema.ts'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3000'
const REGISTRATION_URL = process.env.REGISTRATION_URL ?? 'http://localhost:3002'
const EVENT_DATABASE_URL =
  process.env.EVENT_DATABASE_URL ?? 'postgres://event_svc:event_svc@localhost:5432/event_db'
const REGISTRATION_DATABASE_URL =
  process.env.REGISTRATION_DATABASE_URL ??
  'postgres://registration_svc:registration_svc@localhost:5432/registration_db'

const ORGANISERS = [
  { name: 'Nadia Okafor', email: 'nadia@eventide.test' },
  { name: 'Somchai Pattana', email: 'somchai@eventide.test' },
  { name: 'Lena Vogt', email: 'lena@eventide.test' },
  { name: 'Marco Reyes', email: 'marco@eventide.test' },
] as const

const ATTENDEES = [
  { name: 'Priya Sharma', email: 'priya@eventide.test' },
  { name: 'Tom Becker', email: 'tom@eventide.test' },
  { name: 'Yuki Tanaka', email: 'yuki@eventide.test' },
  { name: 'Alex Dupont', email: 'alex@eventide.test' },
  { name: 'Fatima Al-Sayed', email: 'fatima@eventide.test' },
] as const

// Tickets each attendee books, as offsets into the (shuffled-by-construction)
// event list — 3 distinct events per attendee, no overlap within an attendee.
const TICKETS_PER_ATTENDEE = 3

// Deterministic password for every seeded account — local/demo only.
const SEED_PASSWORD = 'seed-password-123'

const EVENTS: Array<{ title: string; venue: string; capacity: number; inDays: number }> = [
  { title: 'Cloud Native Bangkok Meetup', venue: 'KMITL Auditorium', capacity: 120, inDays: 7 },
  { title: 'Intro to Kubernetes Workshop', venue: 'IT Building Lab 3', capacity: 30, inDays: 10 },
  { title: 'Terraform Deep Dive', venue: 'IT Building Lab 3', capacity: 30, inDays: 14 },
  { title: 'Serverless on AWS', venue: 'Online', capacity: 500, inDays: 15 },
  { title: 'Observability Night', venue: 'Cowork Space Ari', capacity: 60, inDays: 18 },
  { title: 'Postgres Performance Clinic', venue: 'KMITL Room 4201', capacity: 40, inDays: 21 },
  { title: 'React Conf Watch Party', venue: 'Student Union Hall', capacity: 80, inDays: 24 },
  { title: 'Platform Engineering Roundtable', venue: 'KMITL Room 4202', capacity: 25, inDays: 28 },
  { title: 'CI/CD with GitHub Actions', venue: 'Online', capacity: 300, inDays: 30 },
  { title: 'Rust for Backend Developers', venue: 'IT Building Lab 1', capacity: 35, inDays: 33 },
  { title: 'Designing REST & RPC APIs', venue: 'KMITL Auditorium', capacity: 120, inDays: 37 },
  { title: 'Edge Computing Showcase', venue: 'Innovation Center', capacity: 90, inDays: 41 },
  { title: 'Security for Cloud Workloads', venue: 'KMITL Room 4201', capacity: 40, inDays: 45 },
  { title: 'Data Pipelines 101', venue: 'IT Building Lab 2', capacity: 30, inDays: 49 },
  {
    title: 'Year-End Cloud Computing Demo Day',
    venue: 'KMITL Auditorium',
    capacity: 150,
    inDays: 55,
  },
]

type AuthUser = { id: string; email: string }
// The session token comes back in the `set-auth-token` response header (bearer
// plugin); the JWT that event/registration verify is a separate exchange.
type SeededUser = AuthUser & { sessionToken: string }

async function ensureUser(name: string, email: string): Promise<SeededUser> {
  const signUp = await fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: SEED_PASSWORD }),
  })
  if (signUp.ok) {
    const { user } = (await signUp.json()) as { user: AuthUser }
    console.log(`created user ${email}`)
    return { ...user, sessionToken: signUp.headers.get('set-auth-token') ?? '' }
  }

  // Already there — sign in to recover the id + a fresh session token.
  const signIn = await fetch(`${AUTH_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  })
  if (!signIn.ok) {
    throw new Error(`cannot create or sign in ${email}: ${signIn.status} ${await signIn.text()}`)
  }
  const { user } = (await signIn.json()) as { user: AuthUser }
  console.log(`user ${email} already exists`)
  return { ...user, sessionToken: signIn.headers.get('set-auth-token') ?? '' }
}

// Exchange the session token for the short-lived EdDSA JWT that event /
// registration verify against auth's JWKS (§5.1).
async function getJwt(sessionToken: string): Promise<string> {
  const res = await fetch(`${AUTH_URL}/api/auth/token`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  })
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`)
  }
  const { token } = (await res.json()) as { token: string }
  return token
}

async function seedEvents(): Promise<{ id: string }[]> {
  const sql = postgres(EVENT_DATABASE_URL, { max: 1 })
  const db = drizzle(sql, { schema: { events } })
  try {
    const existing = await db.$count(events)
    if (existing > 0 && !process.env.SEED_FORCE) {
      console.log(`event_db already has ${existing} events — skipping (SEED_FORCE=1 to re-seed)`)
      return await db.select({ id: events.id }).from(events)
    }
    if (existing > 0) {
      await db.delete(events)
      console.log(`SEED_FORCE — cleared ${existing} events`)
    }

    const owners = await Promise.all(ORGANISERS.map((o) => ensureUser(o.name, o.email)))
    const now = Date.now()
    const rows = EVENTS.map((e, i) => ({
      title: e.title,
      description: `${e.title} — hosted at ${e.venue}. Seeded demo event.`,
      venue: e.venue,
      startsAt: new Date(now + e.inDays * 24 * 60 * 60 * 1000),
      capacity: e.capacity,
      // biome-ignore lint/style/noNonNullAssertion: round-robin over a non-empty list
      ownerId: owners[i % owners.length]!.id,
    }))
    const inserted = await db.insert(events).values(rows).returning({ id: events.id })
    console.log(`inserted ${inserted.length} events across ${owners.length} organisers`)
    return inserted
  } finally {
    await sql.end()
  }
}

async function seedRegistrations(eventIds: string[]) {
  if (eventIds.length === 0) {
    console.log('no events to book against — skipping ticket seed')
    return
  }

  const health = await fetch(`${REGISTRATION_URL}/health/live`).catch(() => null)
  if (!health?.ok) {
    console.log(`registration service not reachable at ${REGISTRATION_URL} — skipping ticket seed`)
    return
  }

  // On a re-seed, clear tickets so they can't dangle against deleted events
  // (no cross-DB FK — SYSTEM-DESIGN §4.3).
  if (process.env.SEED_FORCE) {
    const sql = postgres(REGISTRATION_DATABASE_URL, { max: 1 })
    try {
      const db = drizzle(sql, { schema: { tickets } })
      const n = await db.$count(tickets)
      if (n > 0) {
        await db.delete(tickets)
        console.log(`SEED_FORCE — cleared ${n} tickets`)
      }
    } catch (err) {
      console.warn(`could not clear tickets (${(err as Error).message}) — continuing`)
    } finally {
      await sql.end()
    }
  }

  let booked = 0
  for (const [i, a] of ATTENDEES.entries()) {
    const user = await ensureUser(a.name, a.email)
    const jwt = await getJwt(user.sessionToken)
    for (let k = 0; k < TICKETS_PER_ATTENDEE; k++) {
      const eventId = eventIds[(i + k * ATTENDEES.length) % eventIds.length]
      if (!eventId) continue
      const res = await fetch(`${REGISTRATION_URL}/api/registrations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ eventId }),
      })
      if (res.ok) {
        booked++
      } else if (res.status === 409) {
        // already registered or genuinely full — fine, keeps the seed idempotent
      } else {
        console.warn(`book ${eventId} for ${a.email} → ${res.status} ${await res.text()}`)
      }
    }
  }
  console.log(`booked ${booked} new tickets across ${ATTENDEES.length} attendees`)
}

async function main() {
  // Fail early if auth isn't reachable — a confusing half-seed otherwise.
  const health = await fetch(`${AUTH_URL}/health/live`).catch(() => null)
  if (!health?.ok) {
    throw new Error(`auth service not reachable at ${AUTH_URL} — start it first (make dev)`)
  }

  const eventIds = (await seedEvents()).map((e) => e.id)
  await seedRegistrations(eventIds)
}

await main()
console.log('seed complete')
