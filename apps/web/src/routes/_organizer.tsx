import { createFileRoute, redirect } from '@tanstack/react-router'
import { DashboardShell } from '@/components/dashboard-shell'
import { authClient } from '@/lib/auth'
import { accessDecision } from '@/lib/route-access'

export const Route = createFileRoute('/_organizer')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    const user = data?.user as
      | (NonNullable<typeof data>['user'] & { role?: string; organizerApprovalStatus?: string })
      | undefined
    const decision = accessDecision(user, 'organizer')
    if (decision === 'login') throw redirect({ to: '/login' })
    if (decision === 'profile') throw redirect({ to: '/profile' })
    return { session: data }
  },
  component: () => <DashboardShell label="Organizer" />,
})
