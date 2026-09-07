import { beforeEach, describe, expect, it } from 'bun:test'
import { checkIns, tickets } from '@eventide/db/registration'
import { eq } from 'drizzle-orm'
import { app } from '../src/index.ts'
import { db } from '../src/lib/db.ts'
import { RegistrationService } from '../src/modules/registration/service.ts'
import {
  authHeader,
  checkoutSummary,
  readJson,
  resetRegistrationDb,
  stubEvent,
  ticketType,
} from './helpers.ts'

const hash = (v: string) => new Bun.CryptoHasher('sha256').update(v).digest('hex')

/** Buy + confirm one ticket, return its live QR token and ids. */
async function issueTicket(buyerId: string) {
  const tt = ticketType({ quota: 10 })
  const summary = stubEvent(checkoutSummary({ ticketTypes: [tt] }))
  const token = await authHeader({ id: buyerId })
  const res = await app.handle(
    new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: {
        authorization: token,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ eventId: summary.id, items: [{ ticketTypeId: tt.id, quantity: 1 }] }),
    }),
  )
  const { id: orderId } = await readJson<{ id: string }>(res)
  await RegistrationService.confirm(orderId, crypto.randomUUID())
  const [issued] = await RegistrationService.tickets(buyerId)
  return { qrToken: issued!.qrToken, ticketId: issued!.id, eventId: summary.id }
}

describe('check-in — scan outcomes', () => {
  beforeEach(resetRegistrationDb)

  it('a valid first scan marks the ticket USED and records SUCCESS', async () => {
    const { qrToken, ticketId, eventId } = await issueTicket('scan-ok')
    const record = await RegistrationService.checkIn(qrToken, eventId, 'gate-1')

    expect(record.result).toBe('SUCCESS')
    expect(record.payloadHash).toBe(hash(qrToken))
    const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    expect(t?.status).toBe('USED')
  })

  it('a second scan of the same ticket records DUPLICATE', async () => {
    const { qrToken, eventId } = await issueTicket('scan-dup')
    await RegistrationService.checkIn(qrToken, eventId, 'gate-1')
    const second = await RegistrationService.checkIn(qrToken, eventId, 'gate-1')
    expect(second.result).toBe('DUPLICATE')
  })

  it('scanning at the wrong event records WRONG_EVENT and does not consume the ticket', async () => {
    const { qrToken, ticketId } = await issueTicket('scan-wrong')
    const record = await RegistrationService.checkIn(qrToken, crypto.randomUUID(), 'gate-9')
    expect(record.result).toBe('WRONG_EVENT')
    const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    expect(t?.status).toBe('VALID')
  })

  it('a tampered token records INVALID with the tampered payload hashed', async () => {
    const { qrToken, eventId } = await issueTicket('scan-tamper')
    const forged = `${qrToken.slice(0, -3)}zzz`
    const record = await RegistrationService.checkIn(forged, eventId, 'gate-1')
    expect(record.result).toBe('INVALID')
    expect(record.payloadHash).toBe(hash(forged))
    expect(record.ticketId).toBeNull()
  })

  it('a cancelled ticket records CANCELLED', async () => {
    const { qrToken, ticketId, eventId } = await issueTicket('scan-cancelled')
    await db.update(tickets).set({ status: 'CANCELLED' }).where(eq(tickets.id, ticketId))
    const record = await RegistrationService.checkIn(qrToken, eventId, 'gate-1')
    expect(record.result).toBe('CANCELLED')
  })

  it('every scan writes one check_ins row', async () => {
    const { qrToken, eventId } = await issueTicket('scan-count')
    await RegistrationService.checkIn(qrToken, eventId, 'gate-1')
    await RegistrationService.checkIn(qrToken, eventId, 'gate-1')
    expect(await db.select().from(checkIns).where(eq(checkIns.eventId, eventId))).toHaveLength(2)
  })
})
