import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { eventsQuery } from '@/lib/queries'

const searchSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  province: z.string().optional(),
  page: z.coerce.number().int().positive().catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
})
export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(eventsQuery(deps)),
  component: EventsPage,
})

function EventsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data } = useSuspenseQuery(eventsQuery(search))
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Badge variant="secondary">Discover Bangkok and beyond</Badge>
        <h1 className="max-w-3xl font-heading text-4xl font-semibold tracking-tight">
          Find your next unforgettable event.
        </h1>
        <p className="text-muted-foreground">
          Curated concerts, workshops, markets, and community gatherings across Thailand.
        </p>
      </section>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          void navigate({ search: (old) => ({ ...old, q: String(form.get('q') ?? ''), page: 1 }) })
        }}
      >
        <Input
          name="q"
          defaultValue={search.q}
          placeholder="Search events"
          aria-label="Search events"
        />
        <Button type="submit">
          <Search data-icon="inline-start" />
          Search
        </Button>
      </form>
      {data.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No events found</EmptyTitle>
            <EmptyDescription>Try another search or come back soon.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((event) => (
            <Card key={event.id}>
              <CardHeader>
                <CardTitle>{event.title}</CardTitle>
                <CardDescription>
                  {new Intl.DateTimeFormat('en-TH', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Bangkok',
                  }).format(new Date(event.startsAt))}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-3 text-muted-foreground">{event.description}</p>
              </CardContent>
              <CardFooter>
                <Button
                  variant="outline"
                  render={<Link to="/events/$eventId" params={{ eventId: event.id }} />}
                >
                  View tickets
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
