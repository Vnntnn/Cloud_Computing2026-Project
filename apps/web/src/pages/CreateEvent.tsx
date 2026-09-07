import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { authClient } from '../lib/auth'
import { edenEvent } from '../lib/eden'

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type CoverType = (typeof COVER_TYPES)[number]
const isCoverType = (t: string): t is CoverType => (COVER_TYPES as readonly string[]).includes(t)

export function CreateEvent() {
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (isPending) return <p className="text-muted">Loading…</p>
  if (!session) {
    navigate('/login')
    return null
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const form = new FormData(e.currentTarget)
    const file = form.get('cover') as File | null

    const { data: event, error: createErr } = await edenEvent.api.events.post({
      title: String(form.get('title')),
      description: String(form.get('description') ?? ''),
      venue: String(form.get('venue')),
      startsAt: new Date(String(form.get('startsAt'))).toISOString(),
      capacity: Number(form.get('capacity')),
    })
    if (createErr || !event) {
      setBusy(false)
      setError((createErr?.value as { message?: string })?.message ?? 'Could not create the event')
      return
    }

    // Cover image: ask event for a presigned PUT, then upload straight to S3.
    if (file && file.size > 0 && isCoverType(file.type)) {
      const { data: up } = await edenEvent.api
        .events({ id: event.id })
        ['cover-upload'].post({ contentType: file.type })
      if (up?.uploadUrl) {
        await fetch(up.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type },
          body: file,
        })
      }
    }

    setBusy(false)
    navigate(`/events/${event.id}`)
  }

  return (
    <Card className="mx-auto max-w-lg">
      <h1 className="text-lg font-semibold">New event</h1>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <Input name="title" placeholder="Title" required maxLength={200} />
        <Input name="venue" placeholder="Venue" required maxLength={200} />
        <textarea
          name="description"
          placeholder="Description"
          rows={3}
          maxLength={5000}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="flex gap-3">
          <Input name="startsAt" type="datetime-local" required className="flex-1" />
          <Input
            name="capacity"
            type="number"
            min={1}
            placeholder="Capacity"
            required
            className="w-32"
          />
        </div>
        <label className="block text-sm text-muted">
          Cover image (optional — JPEG / PNG / WebP)
          <input
            name="cover"
            type="file"
            accept={COVER_TYPES.join(',')}
            className="mt-1 block w-full text-sm"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creating…' : 'Create event'}
        </Button>
      </form>
    </Card>
  )
}
