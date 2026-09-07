import { env } from '../env.ts'

export interface TicketTypeSummary {
  id: string
  eventId: string
  name: string
  description: string
  price: string
  quota: number
  maxPerOrder: number
  salesStartAt: string | null
  salesEndAt: string | null
}

export interface CheckoutSummary {
  id: string
  ownerId: string
  title: string
  status: string
  refundPercent: number
  salesStartAt: string
  salesEndAt: string
  ticketTypes: TicketTypeSummary[]
}

export class EventNotFound extends Error {}
export class EventServiceUnavailable extends Error {}

export async function fetchCheckoutSummary(eventId: string): Promise<CheckoutSummary> {
  let response: Response
  try {
    response = await fetch(`${env.EVENT_SERVICE_URL}/internal/events/${eventId}/checkout-summary`, {
      headers: { 'x-eventide-internal-token': env.INTERNAL_SERVICE_TOKEN },
    })
  } catch (cause) {
    throw new EventServiceUnavailable('event service unreachable', { cause })
  }
  if (response.status === 404) throw new EventNotFound(`event ${eventId} not found`)
  if (!response.ok) throw new EventServiceUnavailable(`event service returned ${response.status}`)
  return response.json() as Promise<CheckoutSummary>
}
