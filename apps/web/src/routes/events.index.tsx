import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { EventCard } from '@/components/event-card'
import { PageHeader } from '@/components/page-header'
import { SiteFooter } from '@/components/site-footer'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { eventsQuery } from '@/lib/queries'
import { eventsSearchSchema } from '@/lib/search'

export const Route = createFileRoute('/events/')({
  validateSearch: eventsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(eventsQuery(deps)),
  component: EventsListPage,
})

function EventsListPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data } = useSuspenseQuery(eventsQuery(search))
  const hasPrev = search.page > 1
  const hasNext = data.items.length === search.pageSize

  return (
    <div className="flex flex-1 flex-col">
      <main className="container mx-auto flex-1 px-4 py-10">
        <div className="mb-8 flex flex-col gap-4">
          <PageHeader
            title="All events"
            description="Every event currently open for registration."
          />
          <form
            className="relative w-full sm:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              void navigate({
                search: (old) => ({ ...old, q: String(form.get('q') ?? ''), page: 1 }),
              })
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={search.q}
              placeholder="Search events"
              aria-label="Search events"
              className="pl-9"
            />
          </form>
        </div>

        {data.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No events found</EmptyTitle>
              <EmptyDescription>Try another search or come back soon.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}

        {hasPrev || hasNext ? (
          <div className="mt-10 flex items-center justify-between">
            <Button
              variant="outline"
              disabled={!hasPrev}
              onClick={() =>
                void navigate({ search: (old) => ({ ...old, page: Math.max(1, old.page - 1) }) })
              }
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {search.page}</span>
            <Button
              variant="outline"
              disabled={!hasNext}
              onClick={() => void navigate({ search: (old) => ({ ...old, page: old.page + 1 }) })}
            >
              Next
            </Button>
          </div>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  )
}
