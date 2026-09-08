import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, CalendarOff, Check, Sparkles } from 'lucide-react'
import { EventCard } from '@/components/event-card'
import { SiteFooter } from '@/components/site-footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { eventsQuery } from '@/lib/queries'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

const ORGANIZER_FEATURES = [
  'Publish events with multiple ticket types',
  'Capacity enforced per event, no overselling',
  'QR check-in for staff at the door',
  'Sales and attendance summaries in real time',
]

function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Hero />
      <UpcomingEvents />
      <OrganizerCta />
      <SiteFooter />
    </div>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 right-0 -z-10 h-64 w-96 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="container mx-auto flex flex-col items-center px-4 py-20 text-center sm:py-28">
        <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="size-3.5 text-primary" />
          Concerts, workshops, and community events across Thailand
        </p>
        <h1 className="max-w-3xl font-heading text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          Find your next
          <br />
          <span className="text-primary">unforgettable event.</span>
        </h1>
        <p className="mt-4 max-w-xl text-balance text-muted-foreground">
          Browse curated events, reserve tickets in a few clicks, and manage everything from one
          place — or apply to become an organizer and run your own.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" render={<Link to="/events" />}>
            Browse events
            <ArrowRight data-icon="inline-end" />
          </Button>
          <Button size="lg" variant="outline" render={<Link to="/profile" />}>
            Become an organizer
          </Button>
        </div>
      </div>
    </section>
  )
}

function UpcomingEvents() {
  const { data, isPending } = useQuery(eventsQuery({ page: 1, pageSize: 6 }))
  const items = data?.items ?? []

  return (
    <section className="container mx-auto px-4 py-16">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-2xl font-black tracking-tight sm:text-3xl">
            Upcoming events
          </h2>
          <p className="text-sm text-muted-foreground">The latest events open for registration.</p>
        </div>
        <Button variant="ghost" render={<Link to="/events" />}>
          View all
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>

      {isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder list
                i
              }
              className="aspect-[4/3] rounded-xl"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <CalendarOff />
            <EmptyTitle>No upcoming events</EmptyTitle>
            <EmptyDescription>Check back soon, or apply to create the first one.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </section>
  )
}

function OrganizerCta() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-1/2 -z-10 h-64 w-96 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <Badge variant="secondary" className="mb-4">
            Free events only, for now
          </Badge>
          <h2 className="font-heading text-2xl font-black tracking-tight sm:text-3xl">
            Want to run your own event?
          </h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Submit an organizer application. Once an admin approves it, you can create and manage
            events right away.
          </p>
          <ul className="mt-6 grid gap-2 text-left text-sm sm:grid-cols-2">
            {ORGANIZER_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="text-muted-foreground">{feature}</span>
              </li>
            ))}
          </ul>
          <Button size="lg" className="mt-8" render={<Link to="/profile" />}>
            Apply to become an organizer
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </section>
  )
}
