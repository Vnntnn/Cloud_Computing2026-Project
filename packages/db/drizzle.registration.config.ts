import { defineConfig } from 'drizzle-kit'

// Emits SQL migration files for `registration_db`. `generate` diffs the schema
// only and does not connect; `migrate` reads DATABASE_URL from the environment
// and is run in-cluster by the migration Job (week 2+).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/registration/schema.ts',
  out: './migrations/registration',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
