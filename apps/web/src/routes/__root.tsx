import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { CalendarDays, LogOut, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { authClient, signOut } from '@/lib/auth'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  const { data: session } = authClient.useSession()
  const navigate = useNavigate()
  const current = session?.user as
    | (NonNullable<typeof session>['user'] & { role?: string })
    | undefined
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link
            to="/"
            search={{ page: 1, pageSize: 20 }}
            className="flex items-center gap-2 font-heading text-lg font-semibold"
          >
            <CalendarDays />
            Eventide
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Button variant="ghost" render={<Link to="/" search={{ page: 1, pageSize: 20 }} />}>
              Events
            </Button>
            {session ? (
              <>
                <Button variant="ghost" render={<Link to="/orders" />}>
                  <Ticket data-icon="inline-start" />
                  Orders
                </Button>
                <Button variant="ghost" render={<Link to="/tickets" />}>
                  Tickets
                </Button>
                {current?.role === 'organizer' || current?.role === 'admin' ? (
                  <Button variant="ghost" render={<Link to="/organizer/events" />}>
                    Organizer
                  </Button>
                ) : null}
                {current?.role === 'admin' ? (
                  <Button variant="ghost" render={<Link to="/admin/users" />}>
                    Admin
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={async () => {
                    await signOut()
                    await navigate({ to: '/', search: { page: 1, pageSize: 20 } })
                  }}
                >
                  <LogOut data-icon="inline-start" />
                  Log out
                </Button>
              </>
            ) : (
              <Button render={<Link to="/login" />}>Log in</Button>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
