import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Ticket } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { TicketQrCode } from '@/components/ticket-qr-code'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ticketsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_authenticated/tickets')({
  loader: ({ context }) => context.queryClient.ensureQueryData(ticketsQuery),
  component: TicketsPage,
})

function TicketsPage() {
  const { data = [] } = useQuery(ticketsQuery)
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Your tickets" description="Present your QR code at the event entrance." />
      {data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <Ticket />
            <EmptyTitle>No tickets issued</EmptyTitle>
            <EmptyDescription>Tickets appear after successful payment.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((ticket) => (
            <Card key={ticket.id}>
              <CardHeader>
                <CardTitle>{ticket.eventTitle}</CardTitle>
                <CardDescription>{ticket.ticketTypeName}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant={ticket.status === 'VALID' ? 'default' : 'secondary'}>
                    {ticket.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Ticket {ticket.id.slice(0, 8)}
                  </span>
                </div>
                <TicketQrCode eventTitle={ticket.eventTitle} token={ticket.qrToken} />
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                Keep this code private. Each ticket can be checked in once.
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
