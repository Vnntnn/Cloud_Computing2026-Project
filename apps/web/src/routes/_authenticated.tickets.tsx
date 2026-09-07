import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Copy, Ticket } from 'lucide-react'
import { toast } from 'sonner'
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
import { ticketsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_authenticated/tickets')({
  loader: ({ context }) => context.queryClient.ensureQueryData(ticketsQuery),
  component: TicketsPage,
})

function TicketsPage() {
  const { data = [] } = useQuery(ticketsQuery)
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-semibold">Your tickets</h1>
        <p className="text-muted-foreground">Present the signed token at event check-in.</p>
      </div>
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
              <CardContent>
                <Badge>{ticket.status}</Badge>
                <p className="mt-4 break-all rounded-2xl bg-muted p-3 text-xs">{ticket.qrToken}</p>
              </CardContent>
              <CardFooter>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(ticket.qrToken)
                    toast.success('Ticket token copied')
                  }}
                >
                  <Copy data-icon="inline-start" />
                  Copy token
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
