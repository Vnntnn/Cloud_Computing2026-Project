import { createFileRoute, redirect } from '@tanstack/react-router'
import { DashboardShell } from '@/components/dashboard-shell'
import { authClient } from '@/lib/auth'
import { accessDecision } from '@/lib/route-access'

export const Route = createFileRoute('/_admin')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    const user = data?.user as (NonNullable<typeof data>['user'] & { role?: string }) | undefined
    const decision = accessDecision(user, 'admin')
    if (decision === 'login') throw redirect({ to: '/login' })
    if (decision === 'home') throw redirect({ to: '/' })
    return { session: data }
  },
  component: () => <DashboardShell label="Administration" />,
})
