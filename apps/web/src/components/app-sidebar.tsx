import { Link, useRouterState } from '@tanstack/react-router'
import {
  CalendarPlus,
  CalendarRange,
  ClipboardList,
  CreditCard,
  Home,
  ScanLine,
  ScrollText,
  Ticket,
  Users,
} from 'lucide-react'
import { BrandMark } from '@/components/logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

type NavItem = {
  title: string
  to: string
  search?: Record<string, unknown>
  icon: React.ReactNode
}

type NavGroup = { label: string; items: NavItem[] }

const ORGANIZER_GROUP: NavGroup = {
  label: 'Organizer',
  items: [
    { title: 'My events', to: '/organizer/events', icon: <CalendarRange /> },
    { title: 'Create event', to: '/organizer/events/new', icon: <CalendarPlus /> },
    { title: 'Check-in', to: '/organizer/check-in', search: {}, icon: <ScanLine /> },
  ],
}

const ADMIN_GROUP: NavGroup = {
  label: 'Administration',
  items: [
    { title: 'Users', to: '/admin/users', icon: <Users /> },
    { title: 'Events', to: '/admin/events', icon: <CalendarRange /> },
    { title: 'Payments', to: '/admin/payments', icon: <CreditCard /> },
    { title: 'Audit log', to: '/admin/audit', icon: <ScrollText /> },
    { title: 'Check-in', to: '/admin/check-in', search: {}, icon: <ScanLine /> },
  ],
}

export function AppSidebar({
  role,
  ...props
}: { role?: string } & React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const groups: NavGroup[] = [
    role === 'organizer' || role === 'admin' ? ORGANIZER_GROUP : null,
    role === 'admin' ? ADMIN_GROUP : null,
  ].filter((group): group is NavGroup => group !== null)

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <BrandMark />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(item.to)}
                      tooltip={item.title}
                      render={
                        <Link to={item.to} {...(item.search ? { search: item.search } : {})} />
                      }
                    >
                      {item.icon}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="My tickets" render={<Link to="/tickets" />}>
              <Ticket />
              <span>My tickets</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="My orders" render={<Link to="/orders" />}>
              <ClipboardList />
              <span>My orders</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Back to site" render={<Link to="/" />}>
              <Home />
              <span>Back to site</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
