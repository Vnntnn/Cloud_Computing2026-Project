import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db.ts'
import type { CheckoutSummary, TicketTypeSummary } from '../src/lib/event-client.ts'
import { eventService } from './setup.ts'

export { authHeader, mintToken, readJson } from '@eventide/shared/testing'

export async function resetRegistrationDb(): Promise<void> {
  await db.execute(
    sql`truncate ticket_inventory, orders, order_items, order_audit_logs, tickets, check_ins, idempotency_keys restart identity cascade`,
  )
}

const uuid = () => crypto.randomUUID()

export function ticketType(over: Partial<TicketTypeSummary> = {}): TicketTypeSummary {
  return {
    id: uuid(),
    eventId: uuid(),
    name: 'General admission',
    description: '',
    price: '500.00',
    quota: 100,
    maxPerOrder: 10,
    maxPerUser: 20,
    salesStartAt: null,
    salesEndAt: null,
    ...over,
  }
}

export function checkoutSummary(over: Partial<CheckoutSummary> = {}): CheckoutSummary {
  const id = over.id ?? uuid()
  const now = Date.now()
  return {
    id,
    ownerId: 'organizer-1',
    title: 'Test Event',
    status: 'PUBLISHED',
    refundPercent: 100,
    salesStartAt: new Date(now - 86_400_000).toISOString(),
    salesEndAt: new Date(now + 86_400_000).toISOString(),
    ...over,
    ticketTypes: (over.ticketTypes ?? [ticketType()]).map((t) => ({ ...t, eventId: id })),
  }
}

/** Make the event peer answer /internal/events/:id/checkout-summary with `summary`. */
export function stubEvent(summary: CheckoutSummary): CheckoutSummary {
  eventService.reset()
  eventService.route(/\/internal\/events\/([^/]+)\/checkout-summary$/, (m) =>
    m[1] === summary.id ? Response.json(summary) : new Response('event not found', { status: 404 }),
  )
  return summary
}
