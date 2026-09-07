import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/ui/card'
import { edenEvent } from '../lib/eden'

type EventRow = {
  id: string
  title: string
  venue: string
  startsAt: string
  capacity: number
}

export function EventList() {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    edenEvent.api.events.get().then(({ data, error }) => {
      if (error) setError(String(error.value))
      else setEvents(data as EventRow[])
    })
  }, [])

  if (error) return <p className="text-danger">Failed to load events: {error}</p>
  if (!events) return <p className="text-muted">Loading…</p>
  if (events.length === 0) return <p className="text-muted">No events yet.</p>

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {events.map((e) => (
        <Link key={e.id} to={`/events/${e.id}`}>
          <Card className="h-full transition hover:border-accent">
            <h2 className="font-medium">{e.title}</h2>
            <p className="mt-1 text-sm text-muted">
              {e.venue} · {new Date(e.startsAt).toLocaleDateString()} · {e.capacity} seats
            </p>
          </Card>
        </Link>
      ))}
    </div>
  )
}
