import { Link, useNavigate } from '@tanstack/react-router'
import { LayoutDashboard, LogOut, ScanLine, Ticket } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { authClient, signOut } from '@/lib/auth'

type SessionUser = {
  name?: string
  email?: string
  image?: string | null
  role?: string
}

export function UserMenu() {
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return <Skeleton className="h-9 w-24" />

  if (!session) {
    return <Button render={<Link to="/login" />}>Log in</Button>
  }

  const user = session.user as SessionUser
  const role = user.role
  const initial = user.name?.trim().charAt(0).toUpperCase() || '?'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="gap-2 px-2" />}
        aria-label="Account menu"
      >
        <Avatar className="size-7">
          <AvatarImage src={user.image ?? undefined} alt="" />
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="max-w-56 truncate font-normal text-muted-foreground">
            {user.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link to="/tickets" />}>
            <Ticket data-icon="inline-start" />
            Tickets
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/orders" />}>
            <LayoutDashboard data-icon="inline-start" />
            Orders
          </DropdownMenuItem>
          {role === 'organizer' || role === 'admin' ? (
            <DropdownMenuItem render={<Link to="/organizer/events" />}>
              <LayoutDashboard data-icon="inline-start" />
              Organizer
            </DropdownMenuItem>
          ) : null}
          {role === 'admin' ? (
            <DropdownMenuItem render={<Link to="/admin/users" />}>
              <ScanLine data-icon="inline-start" />
              Admin
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
              await signOut()
              await navigate({ to: '/' })
            }}
          >
            <LogOut data-icon="inline-start" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
