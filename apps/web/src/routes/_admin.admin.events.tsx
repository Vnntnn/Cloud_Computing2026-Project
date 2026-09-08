import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
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

export const Route = createFileRoute('/_admin/admin/events')({
  loader: ({ context }) => context.queryClient.ensureQueryData(managedEventsQuery),
  component: AdminEventsPage,
})

function AdminEventsPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(managedEventsQuery)
  const suspend = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await edenEvent.api.admin.events({ id: eventId }).suspend.post()
      if (error) throw new Error('Only published events can be suspended.')
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', 'managed'] }),
        queryClient.invalidateQueries({ queryKey: ['events'] }),
      ])
      toast.success('Event suspended')
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event moderation</CardTitle>
        <CardDescription>
          Review every event and suspend published listings when required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No events found</EmptyTitle>
              <EmptyDescription>
                Events will appear here after organizers create them.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link
                      to="/events/$eventId"
                      params={{ eventId: event.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {event.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={event.status === 'SUSPENDED' ? 'destructive' : 'secondary'}>
                      {event.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(event.startsAt).toLocaleDateString('en-TH', {
                      timeZone: 'Asia/Bangkok',
                    })}
                  </TableCell>
                  <TableCell>{event.capacity}</TableCell>
                  <TableCell>
                    {event.status === 'PUBLISHED' ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={suspend.isPending}
                        onClick={() => suspend.mutate(event.id)}
                      >
                        <ShieldAlert data-icon="inline-start" />
                        Suspend
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">No action</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
