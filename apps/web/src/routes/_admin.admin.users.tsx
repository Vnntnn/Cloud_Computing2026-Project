import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
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
import { authApiFetch } from '@/lib/auth'
import { type AdminUser, adminUsersQuery } from '@/lib/queries'

export const Route = createFileRoute('/_admin/admin/users')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminUsersQuery),
  component: AdminUsersPage,
})
function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(adminUsersQuery)
  const act = useMutation({
    mutationFn: async ({ user, action }: { user: AdminUser; action: string }) => {
      const paths: Record<string, string> = {
        approve: `/api/admin/organizers/${user.id}/approve`,
        reject: `/api/admin/organizers/${user.id}/reject`,
        ban: `/api/admin/users/${user.id}/ban`,
        unban: `/api/admin/users/${user.id}/unban`,
      }
      const withReason = action === 'reject' || action === 'ban'
      const path = paths[action]
      if (!path) throw new Error('Unknown administration action')
      const response = await authApiFetch(path, {
        method: 'POST',
        headers: withReason ? { 'content-type': 'application/json' } : undefined,
        body: withReason
          ? JSON.stringify({
              reason:
                action === 'ban'
                  ? 'Account suspended by administrator'
                  : 'Application rejected by administrator',
            })
          : undefined,
      })
      if (!response.ok) throw new Error(`Unable to ${action} user`)
      return action
    },
    onSuccess: async (action) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(`User ${action} action completed`)
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>User administration</CardTitle>
        <CardDescription>Approve organizers and control account access.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No users found</EmptyTitle>
              <EmptyDescription>New accounts will appear here after sign-up.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Organizer status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge>{user.banned ? 'BANNED' : (user.role ?? 'attendee')}</Badge>
                  </TableCell>
                  <TableCell>{user.organizerApprovalStatus}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {user.organizerApprovalStatus === 'PENDING' ? (
                        <>
                          <Button
                            size="sm"
                            disabled={act.isPending}
                            onClick={() => act.mutate({ user, action: 'approve' })}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={act.isPending}
                            onClick={() => act.mutate({ user, action: 'reject' })}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="sm"
                        variant={user.banned ? 'outline' : 'destructive'}
                        disabled={act.isPending}
                        onClick={() => act.mutate({ user, action: user.banned ? 'unban' : 'ban' })}
                      >
                        {user.banned ? 'Unban' : 'Ban'}
                      </Button>
                    </div>
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
