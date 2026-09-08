import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { EventThumbnail } from '@/components/event-thumbnail'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { edenEvent } from '@/lib/eden'
import { managedEventsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_organizer/organizer/events/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(managedEventsQuery),
  component: OrganizerEventsPage,
})

function OrganizerEventsPage() {
  const queryClient = useQueryClient()
  const { data } = useQuery(managedEventsQuery)
  const transition = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'publish' | 'close' }) => {
      const result = await edenEvent.api.events({ id })[action].post()
      if (result.error) throw new Error(`Unable to ${action} event`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] })
      toast.success('Event status updated')
    },
  })
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My events"
        description="Manage your event lifecycle and check-ins."
        actions={<Button render={<Link to="/organizer/events/new" />}>Create event</Button>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {data?.items.map((event) => (
          <Card key={event.id} className="pt-0">
            <EventThumbnail src={event.coverUrl} title={event.title} className="rounded-t-4xl" />
            <CardHeader>
              <CardTitle>{event.title}</CardTitle>
              <Badge>{event.status}</Badge>
            </CardHeader>
            <CardContent>
              {new Date(event.startsAt).toLocaleString('en-TH', { timeZone: 'Asia/Bangkok' })}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button
                variant="outline"
                render={<Link to="/events/$eventId" params={{ eventId: event.id }} />}
              >
                View
              </Button>
              {event.status === 'DRAFT' ? (
                <Button onClick={() => transition.mutate({ id: event.id, action: 'publish' })}>
                  Publish
                </Button>
              ) : null}
              {event.status === 'PUBLISHED' ? (
                <Button onClick={() => transition.mutate({ id: event.id, action: 'close' })}>
                  Close
                </Button>
              ) : null}
              <Button
                variant="outline"
                render={<Link to="/organizer/check-in" search={{ eventId: event.id }} />}
              >
                Check in
              </Button>
              <Button
                variant="outline"
                render={
                  <Link to="/organizer/events/$eventId/images" params={{ eventId: event.id }} />
                }
              >
                Images
              </Button>
              <Button
                variant="outline"
                render={
                  <Link to="/organizer/events/$eventId/sales" params={{ eventId: event.id }} />
                }
              >
                Sales
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
