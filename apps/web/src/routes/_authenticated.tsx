import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { authClient } from '@/lib/auth'
import { accessDecision } from '@/lib/route-access'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (accessDecision(data?.user, 'authenticated') === 'login') throw redirect({ to: '/login' })
    return { session: data }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return (
    <main className="container mx-auto flex-1 px-4 py-10">
      <Outlet />
    </main>
  )
}
