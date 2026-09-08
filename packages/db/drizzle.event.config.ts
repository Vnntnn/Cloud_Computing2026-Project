import { defineConfig } from 'drizzle-kit'

// Emits SQL migration files for `event_db`. `generate` diffs the schema only and
// does not connect; `migrate` reads DATABASE_URL from the environment and is run
// in-cluster by the migration Job (week 2+), never from a laptop — RDS is not
// reachable from outside the VPC.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/event/schema.ts',
  out: './migrations/event',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
