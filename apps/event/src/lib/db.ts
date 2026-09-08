import * as schema from '@eventide/db/event'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.ts'

/**
 * Drizzle instance over `event_db`. postgres.js is lazy — no socket opens until
 * the first query — so importing this from a unit test is safe.
 */
const client = postgres(env.DATABASE_URL, { max: 10 })

export const db = drizzle(client, { schema })
