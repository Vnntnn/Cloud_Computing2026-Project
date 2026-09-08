import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db.ts'

export { authHeader, mintToken, readJson } from '@eventide/shared/testing'
export { resetRegistrationStub, seedOrder, setPeerFailure } from './setup.ts'

export async function resetPaymentDb(): Promise<void> {
  await db.execute(sql`truncate payments, payment_attempts, refunds restart identity cascade`)
}
