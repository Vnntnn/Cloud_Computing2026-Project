import { beforeEach, describe, expect, it } from 'bun:test'
import { RegistrationService } from '../src/modules/registration/service.ts'
import { checkoutSummary, resetRegistrationDb, stubEvent, ticketType } from './helpers.ts'

describe('organizer sales summary', () => {
  beforeEach(resetRegistrationDb)

  it('reports revenue, inventory, orders, and successful check-ins from trusted data', async () => {
    const type = ticketType({ quota: 10, price: '500.00', maxPerUser: 5 })
    const event = stubEvent(checkoutSummary({ ticketTypes: [type] }))
    const confirmed = await RegistrationService.create(
      { eventId: event.id, items: [{ ticketTypeId: type.id, quantity: 2 }] },
      'sales-buyer-confirmed',
      'sales-confirmed',
    )
    await RegistrationService.confirm(confirmed.id, crypto.randomUUID())
    await RegistrationService.create(
      { eventId: event.id, items: [{ ticketTypeId: type.id, quantity: 1 }] },
      'sales-buyer-pending',
      'sales-pending',
    )

    const [ticket] = await RegistrationService.tickets('sales-buyer-confirmed')
    if (!ticket) throw new Error('confirmed ticket was not issued')
    await RegistrationService.checkIn(ticket.qrToken, event.id, 'sales-organizer')

    expect(await RegistrationService.salesSummary(event.id)).toEqual({
      eventId: event.id,
      totalOrders: 2,
      pendingOrders: 1,
      confirmedOrders: 1,
      refundedOrders: 0,
      totalQuota: 10,
      reservedTickets: 1,
      soldTickets: 2,
      successfulCheckIns: 1,
      netRevenue: '1000.00',
    })
  })
})
