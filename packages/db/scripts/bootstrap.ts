/**
 * One-shot database bootstrap. Connects as the Postgres master and:
 *   1. creates the per-service role + database if missing (raw SQL — drizzle-kit
 *      has no API for CREATE DATABASE / CREATE ROLE, and they can't run in a txn)
 *   2. runs the drizzle migrations for each service database
 *
 * Local dev runs this against the compose container. On EKS this same script
 * runs as the in-cluster migration Job connecting to RDS (SYSTEM-DESIGN §7.1).
 *
 *   MASTER_DATABASE_URL   postgres://<master>:<pw>@<host>:5432/postgres
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const MASTER_URL =
  process.env.MASTER_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'

// SYSTEM-DESIGN §4.1 — one database per service, each owned by its own role,
// with no grants on the others. Passwords here are local-only; on RDS they come
// from Secrets Manager.
const SERVICES = [
  { role: 'auth_svc', db: 'auth_db', config: null },
  { role: 'event_svc', db: 'event_db', config: 'drizzle.event.config.ts' },
  { role: 'registration_svc', db: 'registration_db', config: 'drizzle.registration.config.ts' },
] as const

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))

async function createDatabases() {
  const sql = postgres(MASTER_URL, { max: 1 })
  try {
    for (const { role, db } of SERVICES) {
      const pw = process.env[`${role.toUpperCase()}_PASSWORD`] ?? role
      const [{ exists: roleExists } = { exists: false }] = await sql`
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`
      if (!roleExists) {
        await sql.unsafe(`CREATE ROLE ${role} WITH LOGIN PASSWORD '${pw}'`)
        console.log(`created role ${role}`)
      }

      const [{ exists: dbExists } = { exists: false }] = await sql`
        SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${db}) AS exists`
      if (!dbExists) {
        await sql.unsafe(`CREATE DATABASE ${db} OWNER ${role}`)
        await sql.unsafe(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`)
        console.log(`created database ${db} (owner ${role})`)
      }
    }
  } finally {
    await sql.end()
  }
}

function runMigrations() {
  const base = new URL(MASTER_URL)
  for (const { db, role, config } of SERVICES) {
    if (!config) continue // auth_db schema is owned by the better-auth CLI (§4.2)
    const url = new URL(base)
    url.pathname = `/${db}`
    url.username = role
    url.password = process.env[`${role.toUpperCase()}_PASSWORD`] ?? role
    console.log(`migrating ${db}`)
    execFileSync('bunx', ['drizzle-kit', 'migrate', '--config', config], {
      cwd: pkgRoot,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url.toString() },
    })
  }
}

await createDatabases()
runMigrations()
console.log('bootstrap complete')
