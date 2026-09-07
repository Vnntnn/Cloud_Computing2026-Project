import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { authApiFetch } from '@/lib/auth'

type UserRow = {
  id: string
  name: string
  email: string
  role?: string
  organizerApprovalStatus: string
  banned?: boolean
}
export const Route = createFileRoute('/_admin/admin/users')({ component: AdminUsersPage })
function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const response = await authApiFetch('/api/admin/users?page=1&pageSize=100')
      if (!response.ok) throw new Error('Unable to load users')
      const body = (await response.json()) as { items: UserRow[] }
      return body.items
    },
  })
  const act = useMutation({
    mutationFn: async ({ user, action }: { user: UserRow; action: string }) => {
      const paths: Record<string, string> = {
        approve: `/api/admin/organizers/${user.id}/approve`,
        reject: `/api/admin/organizers/${user.id}/reject`,
        ban: `/api/admin/users/${user.id}/ban`,
        unban: `/api/admin/users/${user.id}/unban`,
      }
      const withReason = action === 'reject' || action === 'ban'
      const response = await authApiFetch(paths[action]!, {
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
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>User administration</CardTitle>
      </CardHeader>
      <CardContent>
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
                        <Button size="sm" onClick={() => act.mutate({ user, action: 'approve' })}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => act.mutate({ user, action: 'reject' })}
                        >
                          Reject
                        </Button>
                      </>
                    ) : null}
                    <Button
                      size="sm"
                      variant={user.banned ? 'outline' : 'destructive'}
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
      </CardContent>
    </Card>
  )
}
