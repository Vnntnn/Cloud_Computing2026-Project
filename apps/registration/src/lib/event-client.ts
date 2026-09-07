import { env } from '../env.ts'

/** The trimmed shape `event` exposes at `GET /api/events/:id/summary` (§4.4). */
export interface EventSummary {
  id: string
  title: string
  capacity: number
}

export class EventNotFound extends Error {
  constructor(eventId: string) {
    super(`event ${eventId} not found`)
  }
}

export class EventServiceUnavailable extends Error {}

/**
 * The one in-cluster hop: `registration` asks `event` for a booking's title +
 * capacity, then stores both alongside the ticket so capacity enforcement is a
 * single local transaction (SYSTEM-DESIGN §4.3).
 */
export async function fetchEventSummary(eventId: string): Promise<EventSummary> {
  let res: Response
  try {
    res = await fetch(`${env.EVENT_SERVICE_URL}/api/events/${eventId}/summary`)
  } catch (cause) {
    throw new EventServiceUnavailable('event service unreachable', { cause })
  }
  if (res.status === 404) throw new EventNotFound(eventId)
  if (!res.ok) throw new EventServiceUnavailable(`event service returned ${res.status}`)
  return (await res.json()) as EventSummary
}
