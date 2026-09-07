import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/ui/card'
import { authClient } from '../lib/auth'
import { edenReg } from '../lib/eden'

type Ticket = {
  id: string
  eventId: string
  eventTitle: string
  eventCapacity: number
  createdAt: string
}

export function MyTickets() {
  const { data: session, isPending } = authClient.useSession()
  const [tickets, setTickets] = useState<Ticket[] | null>(null)

  useEffect(() => {
    if (!session) return
    edenReg.api.registrations.me.get().then(({ data }) => setTickets((data as Ticket[]) ?? []))
  }, [session])

  if (isPending) return <p className="text-muted">Loading…</p>
  if (!session)
    return (
      <p className="text-muted">
        Please{' '}
        <Link to="/login" className="underline">
          log in
        </Link>{' '}
        to see your tickets.
      </p>
    )
  if (!tickets) return <p className="text-muted">Loading…</p>
  if (tickets.length === 0) return <p className="text-muted">No tickets yet.</p>

  return (
    <div className="space-y-3">
      {tickets.map((t) => (
        <Card key={t.id}>
          <Link to={`/events/${t.eventId}`} className="font-medium hover:underline">
            {t.eventTitle}
          </Link>
          <p className="mt-1 text-sm text-muted">
            Registered {new Date(t.createdAt).toLocaleString()}
          </p>
        </Card>
      ))}
    </div>
  )
}
