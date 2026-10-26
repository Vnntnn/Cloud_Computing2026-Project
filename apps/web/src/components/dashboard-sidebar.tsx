import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, ClipboardCheck, LayoutDashboard, Tags, UserRound, Users, type LucideIcon } from "lucide-react";
import type { Role } from "@app/auth-guard/permissions";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useT, type MessageKey } from "@/i18n";
import { pendingApplicationsQueryOptions } from "@/lib/organizer-applications";
import { hasRole, useSession } from "@/lib/session";

type NavItem = {
  title: MessageKey;
  to: "/dashboard" | "/dashboard/events" | "/dashboard/categories" | "/dashboard/users" | "/dashboard/applications" | "/profile";
  icon: LucideIcon;
};

const sections: { label: MessageKey; roles: Role[]; items: NavItem[] }[] = [
  {
    label: "shared.sidebar.manageEvents",
    roles: ["organizer", "admin"],
    items: [
      { title: "shared.sidebar.overview", to: "/dashboard", icon: LayoutDashboard },
      { title: "shared.sidebar.myEvents", to: "/dashboard/events", icon: CalendarDays },
    ],
  },
  {
    label: "shared.sidebar.account",
    roles: ["organizer", "admin"],
    items: [{ title: "shared.sidebar.manageProfile", to: "/profile", icon: UserRound }],
  },
  {
    label: "shared.sidebar.admin",
    roles: ["admin"],
    items: [
      { title: "shared.sidebar.categories", to: "/dashboard/categories", icon: Tags },
      { title: "shared.sidebar.users", to: "/dashboard/users", icon: Users },
      { title: "shared.sidebar.applications", to: "/dashboard/applications", icon: ClipboardCheck },
    ],
  },
];

// nested pages (e.g. editing an event) keep their section highlighted; the overview matches exactly
const isActive = (pathname: string, to: string) => {
  const path = pathname.replace(/\/$/, "");
  return path === to || (to !== "/dashboard" && path.startsWith(`${to}/`));
};

export function DashboardSidebar() {
  const t = useT();
  const { data: session } = useSession();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { setOpenMobile } = useSidebar();
  const isAdmin = hasRole(session?.user, ["admin"]);
  const { data: pending } = useQuery({ ...pendingApplicationsQueryOptions, enabled: isAdmin });

  return (
    // sits below the sticky 4.25rem (h-17) navbar instead of covering it
    <Sidebar className="top-17! h-[calc(100svh-4.25rem)]!">
      <SidebarContent>
        {sections
          .filter((section) => hasRole(session?.user, section.roles))
          .map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{t(section.label)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        isActive={isActive(pathname, item.to)}
                        render={<Link to={item.to} onClick={() => setOpenMobile(false)} />}
                      >
                        <item.icon />
                        <span>{t(item.title)}</span>
                      </SidebarMenuButton>
                      {item.to === "/dashboard/applications" && !!pending?.length && (
                        <SidebarMenuBadge>{pending.length}</SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
      </SidebarContent>
    </Sidebar>
  );
}
