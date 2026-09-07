import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { authClient } from '@/lib/auth'

export const Route = createFileRoute('/_organizer')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    const user = data?.user as
      | (NonNullable<typeof data>['user'] & { role?: string; organizerApprovalStatus?: string })
      | undefined
    if (!user) throw redirect({ to: '/login' })
    if (
      user.role !== 'admin' &&
      (user.role !== 'organizer' || user.organizerApprovalStatus !== 'APPROVED')
    )
      throw redirect({ to: '/profile' })
    return { session: data }
  },
  component: Outlet,
})
