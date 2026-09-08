import { beforeEach, describe, expect, it } from 'bun:test'
import { orderAuditLogs, ticketInventory, tickets } from '@eventide/db/registration'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db.ts'
import { RegistrationService } from '../src/modules/registration/service.ts'
import { checkoutSummary, resetRegistrationDb, stubEvent, ticketType } from './helpers.ts'

describe('orders — refund restoration', () => {
  beforeEach(resetRegistrationDb)

  it('refunds every ticket and restores sold inventory exactly once', async () => {
    const standard = ticketType({ quota: 20, maxPerOrder: 5 })
    const premium = ticketType({ quota: 10, maxPerOrder: 3 })
    const summary = stubEvent(checkoutSummary({ ticketTypes: [standard, premium] }))
    const order = await RegistrationService.create(
      {
        eventId: summary.id,
        items: [
          { ticketTypeId: standard.id, quantity: 2 },
          { ticketTypeId: premium.id, quantity: 1 },
        ],
      },
      'buyer-refund',
      'refund-order',
    )

    await RegistrationService.confirm(order.id, crypto.randomUUID())
    await RegistrationService.refund(order.id)
    await RegistrationService.refund(order.id)

    const refundedOrder = await RegistrationService.get(order.id, 'buyer-refund')
    expect(refundedOrder?.status).toBe('REFUNDED')

    const issued = await db.select().from(tickets).where(eq(tickets.orderId, order.id))
    expect(issued).toHaveLength(3)
    expect(issued.every((ticket) => ticket.status === 'REFUNDED')).toBe(true)

    const inventory = await db.select().from(ticketInventory)
    expect(inventory).toHaveLength(2)
    expect(inventory.every((row) => row.reservedCount === 0 && row.soldCount === 0)).toBe(true)

    const refundLogs = await db
      .select()
      .from(orderAuditLogs)
      .where(eq(orderAuditLogs.action, 'REFUNDED'))
    expect(refundLogs).toHaveLength(1)
  })
})
