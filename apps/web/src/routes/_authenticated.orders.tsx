import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { edenPayment, edenReg } from '@/lib/eden'
import { ordersQuery } from '@/lib/queries'

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
  })
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-semibold">Your orders</h1>
        <p className="text-muted-foreground">Reservations, payments, and purchase history.</p>
      </div>
      {data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No orders yet</EmptyTitle>
            <EmptyDescription>Choose an event to reserve tickets.</EmptyDescription>
          </EmptyHeader>
          <Button render={<Link to="/" search={{ page: 1, pageSize: 20 }} />}>Browse events</Button>
        </Empty>
      ) : (
        <div className="grid gap-4">
          {data.map((order) => (
            <Card key={order.id}>
              <CardHeader>
                <CardTitle>{order.eventTitle}</CardTitle>
                <Badge>{order.status}</Badge>
              </CardHeader>
              <CardContent>
                <p>
                  ฿{order.total} · {order.items.reduce((sum, item) => sum + item.quantity, 0)}{' '}
                  tickets
                </p>
                {order.status === 'PENDING' ? (
                  <p className="text-muted-foreground">
                    Hold expires{' '}
                    {new Date(order.expiresAt).toLocaleTimeString('en-TH', {
                      timeZone: 'Asia/Bangkok',
                    })}
                  </p>
                ) : null}
                {order.status === 'CONFIRMED' && order.refundPercent > 0 ? (
                  <CardFooter>
                    <Button variant="destructive" onClick={() => refund.mutate(order.id)}>
                      Refund {order.refundPercent}%
                    </Button>
                  </CardFooter>
                ) : null}
              </CardContent>
              {order.status === 'PENDING' ? (
                <CardFooter>
                  <Button variant="destructive" onClick={() => cancel.mutate(order.id)}>
                    Cancel reservation
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
