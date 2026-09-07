/**
 * Demo seed — idempotent. Creates a handful of organiser accounts through the
 * `auth` service (better-auth owns password hashing and the `user` table, so
 * users cannot be raw-inserted — SYSTEM-DESIGN §5.1.1) and ~15 events owned by
 * them, written straight into `event_db`.
 *
 * Runs against the LIVE services: locally after `make dev` is up, in-cluster as
 * a Job after deploy. Not part of `make bootstrap` (which only needs the DB).
 *
 *   AUTH_URL             default http://localhost:3000
 *   EVENT_DATABASE_URL   default postgres://event_svc:event_svc@localhost:5432/event_db
 *   SEED_FORCE=1         re-seed even if events already exist
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { events } from '../src/event/schema.ts'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:3000'
const EVENT_DATABASE_URL =
  process.env.EVENT_DATABASE_URL ?? 'postgres://event_svc:event_svc@localhost:5432/event_db'

const ORGANISERS = [
  { name: 'Nadia Okafor', email: 'nadia@eventide.test' },
  { name: 'Somchai Pattana', email: 'somchai@eventide.test' },
  { name: 'Lena Vogt', email: 'lena@eventide.test' },
  { name: 'Marco Reyes', email: 'marco@eventide.test' },
] as const

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

async function ensureUser(name: string, email: string): Promise<AuthUser> {
  const signUp = await fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: SEED_PASSWORD }),
  })
  if (signUp.ok) {
    const { user } = (await signUp.json()) as { user: AuthUser }
    console.log(`created user ${email}`)
    return user
  }

  // Already there — sign in to recover the id.
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
  return user
}

async function main() {
  // Fail early if auth isn't reachable — a confusing half-seed otherwise.
  const health = await fetch(`${AUTH_URL}/health/live`).catch(() => null)
  if (!health?.ok) {
    throw new Error(`auth service not reachable at ${AUTH_URL} — start it first (make dev)`)
  }

  const sql = postgres(EVENT_DATABASE_URL, { max: 1 })
  const db = drizzle(sql, { schema: { events } })
  try {
    const existing = await db.$count(events)
    if (existing > 0 && !process.env.SEED_FORCE) {
      console.log(`event_db already has ${existing} events — skipping (SEED_FORCE=1 to re-seed)`)
      return
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
    await db.insert(events).values(rows)
    console.log(`inserted ${rows.length} events across ${owners.length} organisers`)
  } finally {
    await sql.end()
  }
}

await main()
console.log('seed complete')
