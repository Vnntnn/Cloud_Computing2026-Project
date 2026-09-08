import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  BarChart3,
  Eye,
  Images,
  MoreHorizontal,
  Pencil,
  ScanLine,
  Send,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { EventThumbnail } from '@/components/event-thumbnail'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { edenEvent } from '@/lib/eden'
import { managedEventsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_organizer/organizer/events/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(managedEventsQuery),
  component: OrganizerEventsPage,
})

const dateTimeFormat = new Intl.DateTimeFormat('en-TH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Bangkok',
})

function statusVariant(status: string) {
  if (status === 'PUBLISHED') return 'default' as const
  if (status === 'SUSPENDED') return 'destructive' as const
  if (status === 'CLOSED') return 'outline' as const
  return 'secondary' as const
}

function statusLabel(status: string) {
  return `${status.charAt(0)}${status.slice(1).toLowerCase()}`
}

function OrganizerEventsPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(managedEventsQuery)
  const transition = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'publish' | 'close' }) => {
      const result = await edenEvent.api.events({ id })[action].post()
      if (result.error) throw new Error(`Unable to ${action} event`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] })
      toast.success('Event status updated')
    },
    onError: (error) => toast.error(error.message),
  })

  const eventCount = data.items.length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My events"
        description="Manage your event lifecycle and check-ins."
        actions={<Button render={<Link to="/organizer/events/new" />}>Create event</Button>}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            {eventCount} {eventCount === 1 ? 'event' : 'events'}
          </CardTitle>
          <CardDescription>
            Review schedules, status, capacity, and event operations.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {eventCount === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No events yet</EmptyTitle>
                <EmptyDescription>
                  Create your first event to start selling tickets.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button render={<Link to="/organizer/events/new" />}>Create event</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead className="text-right">Capacity</TableHead>
                  <TableHead className="w-14 pr-6 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="min-w-64 pl-6">
                      <div className="flex items-center gap-3">
                        <EventThumbnail
                          src={event.coverUrl}
                          title={event.title}
                          variant="compact"
                        />
                        <Link
                          to="/events/$eventId"
                          params={{ eventId: event.id }}
                          className="max-w-72 truncate font-heading font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {event.title}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(event.status)}>
                        {statusLabel(event.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{dateTimeFormat.format(new Date(event.startsAt))}</TableCell>
                    <TableCell className="text-right tabular-nums">{event.capacity}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                          aria-label={`Actions for ${event.title}`}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              render={<Link to="/events/$eventId" params={{ eventId: event.id }} />}
                            >
                              <Eye data-icon="inline-start" />
                              View event
                            </DropdownMenuItem>
                            {event.status === 'DRAFT' || event.status === 'PUBLISHED' ? (
                              <DropdownMenuItem
                                render={
                                  <Link
                                    to="/organizer/events/$eventId/edit"
                                    params={{ eventId: event.id }}
                                  />
                                }
                              >
                                <Pencil data-icon="inline-start" />
                                Edit event
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem disabled>
                                <Pencil data-icon="inline-start" />
                                Edit event
                                <DropdownMenuShortcut>Unavailable</DropdownMenuShortcut>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              render={
                                <Link
                                  to="/organizer/events/$eventId/sales"
                                  params={{ eventId: event.id }}
                                />
                              }
                            >
                              <BarChart3 data-icon="inline-start" />
                              Sales
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              render={
                                <Link to="/organizer/check-in" search={{ eventId: event.id }} />
                              }
                            >
                              <ScanLine data-icon="inline-start" />
                              Check in
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              render={
                                <Link
                                  to="/organizer/events/$eventId/images"
                                  params={{ eventId: event.id }}
                                />
                              }
                            >
                              <Images data-icon="inline-start" />
                              Images
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          {event.status === 'DRAFT' || event.status === 'PUBLISHED' ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                {event.status === 'DRAFT' ? (
                                  <DropdownMenuItem
                                    disabled={transition.isPending}
                                    onClick={() =>
                                      transition.mutate({ id: event.id, action: 'publish' })
                                    }
                                  >
                                    <Send data-icon="inline-start" />
                                    Publish event
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={transition.isPending}
                                    onClick={() =>
                                      transition.mutate({ id: event.id, action: 'close' })
                                    }
                                  >
                                    <XCircle data-icon="inline-start" />
                                    Close event
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuGroup>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
