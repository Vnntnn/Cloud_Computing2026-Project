import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Banknote, CheckCircle2, Clock3, TicketCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { eventQuery, salesSummaryQuery } from '@/lib/queries'

export const Route = createFileRoute('/_organizer/organizer/events/$eventId/sales')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(eventQuery(params.eventId)),
      context.queryClient.ensureQueryData(salesSummaryQuery(params.eventId)),
    ]),
  component: EventSalesPage,
})

const metricCards = [
  { key: 'netRevenue', label: 'Net revenue', icon: Banknote },
  { key: 'soldTickets', label: 'Tickets sold', icon: TicketCheck },
  { key: 'successfulCheckIns', label: 'Checked in', icon: CheckCircle2 },
  { key: 'pendingOrders', label: 'Pending orders', icon: Clock3 },
] as const

function EventSalesPage() {
  const { eventId } = Route.useParams()
  const { data: event } = useSuspenseQuery(eventQuery(eventId))
  const { data: summary } = useSuspenseQuery(salesSummaryQuery(eventId))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-semibold">Sales summary</h1>
          <p className="text-muted-foreground">Current booking activity for {event.title}.</p>
        </div>
        <Button variant="outline" render={<Link to="/organizer/events" />}>
          Back to events
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards.map(({ key, label, icon: Icon }) => (
          <Card key={key}>
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <Icon />
                {label}
              </CardDescription>
              <CardTitle className="text-3xl">
                {key === 'netRevenue' ? `฿${summary[key]}` : summary[key]}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory and orders</CardTitle>
          <CardDescription>Live counts from the registration database.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span>Total quota</span>
              <Badge variant="secondary">{summary.totalQuota}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Reserved tickets</span>
              <Badge variant="secondary">{summary.reservedTickets}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Available tickets</span>
              <Badge variant="secondary">
                {summary.totalQuota - summary.reservedTickets - summary.soldTickets}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span>Total orders</span>
              <Badge variant="secondary">{summary.totalOrders}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Confirmed orders</span>
              <Badge variant="secondary">{summary.confirmedOrders}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Refunded orders</span>
              <Badge variant="secondary">{summary.refundedOrders}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
