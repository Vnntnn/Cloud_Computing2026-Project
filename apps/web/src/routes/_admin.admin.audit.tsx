import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
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
import { adminAuditLogsQuery } from '@/lib/queries'

export const Route = createFileRoute('/_admin/admin/audit')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminAuditLogsQuery),
  component: AdminAuditPage,
})

function AdminAuditPage() {
  const { data } = useSuspenseQuery(adminAuditLogsQuery)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Membership audit log</CardTitle>
        <CardDescription>
          Account, organizer, and administrator actions in newest-first order.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No audit entries</EmptyTitle>
              <EmptyDescription>Membership changes will be recorded here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    {new Date(entry.createdAt).toLocaleString('en-TH', {
                      timeZone: 'Asia/Bangkok',
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{entry.action}</Badge>
                  </TableCell>
                  <TableCell>{entry.actorId?.slice(0, 12) ?? 'System'}</TableCell>
                  <TableCell>{entry.targetUserId?.slice(0, 12) ?? 'Removed user'}</TableCell>
                  <TableCell className="max-w-72 truncate" title={entry.details ?? undefined}>
                    {entry.details ?? '—'}
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
