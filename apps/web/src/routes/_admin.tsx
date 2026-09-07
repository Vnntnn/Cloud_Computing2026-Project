import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { authClient } from '@/lib/auth'

export const Route = createFileRoute('/_admin')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    const user = data?.user as (NonNullable<typeof data>['user'] & { role?: string }) | undefined
    if (!user) throw redirect({ to: '/login' })
    if (user.role !== 'admin') throw redirect({ to: '/', search: { page: 1, pageSize: 20 } })
    return { session: data }
  },
  component: Outlet,
})
