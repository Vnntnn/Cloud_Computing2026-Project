import { Link } from '@tanstack/react-router'
import { CalendarDays } from 'lucide-react'
import { EventThumbnail } from '@/components/event-thumbnail'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

export type EventCardEvent = {
  id: string
  title: string
  description?: string | null
  coverUrl: string | null
  startsAt: string | number | Date
  status?: string
}

const dateFmt = new Intl.DateTimeFormat('en-TH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Bangkok',
})

export function EventCard({ event }: { event: EventCardEvent }) {
  return (
    <Link
      to="/events/$eventId"
      params={{ eventId: event.id }}
      className="group block min-w-0 focus-visible:outline-none"
    >
      <Card className="h-full gap-0 overflow-hidden p-0 transition-colors group-hover:border-foreground/20 group-focus-visible:border-ring">
        <div className="relative">
          <EventThumbnail src={event.coverUrl} title={event.title} />
          {event.status && event.status !== 'PUBLISHED' ? (
            <Badge variant="secondary" className="absolute right-3 top-3">
              {event.status}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 p-4">
          <h3 className="line-clamp-2 font-heading text-base font-bold leading-snug">
            {event.title}
          </h3>
          {event.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{event.description}</p>
          ) : null}
          <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <CalendarDays className="size-3.5 shrink-0" />
            {dateFmt.format(new Date(event.startsAt))}
          </p>
        </div>
      </Card>
    </Link>
  )
}
