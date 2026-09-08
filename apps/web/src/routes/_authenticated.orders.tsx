import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { edenPayment, edenReg } from '@/lib/eden'
import { ordersQuery } from '@/lib/queries'

const statusCopy = {
  PENDING: 'Reserved while you complete payment.',
  CONFIRMED: 'Payment complete. Your tickets are ready.',
  PENDING_VERIFICATION:
    'Payment was recorded and confirmation is being verified. Do not pay again.',
  CANCELLED: 'This unpaid reservation was cancelled and its tickets were released.',
  EXPIRED: 'The payment window ended and its tickets were released.',
  REFUNDED: 'The refund completed and these tickets can no longer be used.',
} as const

export const Route = createFileRoute('/_authenticated/orders')({
  loader: ({ context }) => context.queryClient.ensureQueryData(ordersQuery),
  component: OrdersPage,
})

function OrdersPage() {
  const client = useQueryClient()
  const { data = [] } = useQuery(ordersQuery)
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const result = await edenReg.api.orders({ id }).cancel.post()
      if (result.error) throw new Error('Unable to cancel order')
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['orders', 'me'] })
      toast.success('Order cancelled')
    },
    onError: (error) => toast.error(error.message),
  })
  const refund = useMutation({
    mutationFn: async (id: string) => {
      const result = await edenPayment.api.payments.order({ orderId: id }).refund.post()
      if (result.error) throw new Error('Unable to refund order')
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['orders', 'me'] }),
        client.invalidateQueries({ queryKey: ['tickets', 'me'] }),
      ])
      toast.success('Refund completed')
    },
    onError: () =>
      toast.error('Refund could not be completed. Retry once the service is available.'),
  })
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Your orders" description="Reservations, payments, and purchase history." />
      {data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No orders yet</EmptyTitle>
            <EmptyDescription>Choose an event to reserve tickets.</EmptyDescription>
          </EmptyHeader>
          <Button render={<Link to="/events" />}>Browse events</Button>
        </Empty>
      ) : (
        <div className="grid gap-4">
          {data.map((order) => (
            <Card key={order.id}>
              <CardHeader>
                <CardTitle>{order.eventTitle}</CardTitle>
                <CardAction>
                  <Badge
                    variant={
                      order.status === 'CANCELLED' || order.status === 'EXPIRED'
                        ? 'outline'
                        : order.status === 'PENDING_VERIFICATION'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {order.status}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p>
                  ฿{order.total} · {order.items.reduce((sum, item) => sum + item.quantity, 0)}{' '}
                  tickets
                </p>
                <p className="text-muted-foreground">{statusCopy[order.status]}</p>
                {order.status === 'PENDING' ? (
                  <p className="text-muted-foreground">
                    Hold expires{' '}
                    {new Date(order.expiresAt).toLocaleTimeString('en-TH', {
                      timeZone: 'Asia/Bangkok',
                    })}
                  </p>
                ) : null}
              </CardContent>
              {order.status === 'PENDING' ||
              (order.status === 'CONFIRMED' && order.refundPercent > 0) ? (
                <CardFooter className="gap-2">
                  {order.status === 'PENDING' ? (
                    <Button
                      variant="destructive"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(order.id)}
                    >
                      Cancel reservation
                    </Button>
                  ) : null}
                  {order.status === 'CONFIRMED' && order.refundPercent > 0 ? (
                    <Button
                      variant="destructive"
                      disabled={refund.isPending}
                      onClick={() => refund.mutate(order.id)}
                    >
                      Refund {order.refundPercent}%
                    </Button>
                  ) : null}
                </CardFooter>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
