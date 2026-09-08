import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
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
import { edenPayment } from '@/lib/eden'
import { adminPaymentsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_admin/admin/payments')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminPaymentsQuery),
  component: AdminPaymentsPage,
})

function AdminPaymentsPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(adminPaymentsQuery)
  const reconcile = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await edenPayment.api.payments({ id: paymentId }).reconcile.post()
      if (error) throw new Error('Payment reconciliation did not complete.')
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] })
      toast.success('Payment reconciled')
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment reconciliation</CardTitle>
        <CardDescription>
          Retry order confirmation after a successful mock payment without charging twice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No payments found</EmptyTitle>
              <EmptyDescription>Completed checkouts will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{payment.id.slice(0, 8)}</TableCell>
                  <TableCell>{payment.orderId.slice(0, 8)}</TableCell>
                  <TableCell>฿{payment.amount}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        payment.status === 'PENDING_VERIFICATION' ? 'destructive' : 'secondary'
                      }
                    >
                      {payment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(payment.createdAt).toLocaleString('en-TH', {
                      timeZone: 'Asia/Bangkok',
                    })}
                  </TableCell>
                  <TableCell>
                    {payment.status === 'PENDING_VERIFICATION' ? (
                      <Button
                        size="sm"
                        disabled={reconcile.isPending}
                        onClick={() => reconcile.mutate(payment.id)}
                      >
                        <RefreshCw data-icon="inline-start" />
                        Reconcile
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
