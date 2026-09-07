import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { authClient } from '../lib/auth'
import { edenEvent, edenReg } from '../lib/eden'

type EventRow = {
  id: string
  title: string
  description: string
  venue: string
  startsAt: string
  capacity: number
}

export function EventDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: session } = authClient.useSession()
  const [event, setEvent] = useState<EventRow | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    edenEvent.api
      .events({ id })
      .get()
      .then(({ data }) => setEvent(data as EventRow | null))
    edenReg.api.registrations
      .event({ id })
      .count.get()
      .then(({ data }) => setCount(data?.count ?? 0))
  }, [id])

  async function register() {
    if (!session) {
      navigate('/login')
      return
    }
    setBusy(true)
    setMsg(null)
    const { data, error } = await edenReg.api.registrations.post({ eventId: id })
    setBusy(false)
    if (error) {
      setMsg((error.value as { message?: string })?.message ?? 'Registration failed')
    } else if (data) {
      setMsg('Registered — see "My tickets".')
      setCount((c) => (c ?? 0) + 1)
    }
  }

  if (!event) return <p className="text-muted">Loading…</p>

  return (
    <Card className="max-w-xl">
      <h1 className="text-lg font-semibold">{event.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {event.venue} · {new Date(event.startsAt).toLocaleString()}
      </p>
      <p className="mt-3 text-sm">{event.description || 'No description.'}</p>
      <p className="mt-3 text-sm text-muted">
        {count ?? '…'} / {event.capacity} registered
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={register} disabled={busy}>
          {session ? 'Register' : 'Log in to register'}
        </Button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </Card>
  )
}
