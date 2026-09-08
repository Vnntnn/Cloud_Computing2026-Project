import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/payment/schema.ts',
  out: './migrations/payment',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
