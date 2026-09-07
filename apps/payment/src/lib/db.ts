import * as schema from '@eventide/db/payment'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.ts'

export const db = drizzle(postgres(env.DATABASE_URL, { max: 10 }), { schema })
