import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  CalendarPlus,
  LayoutDashboard,
  ChevronsUpDown,
  LockKeyhole,
  MonitorSmartphone,
  Ticket,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/i18n";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/_authed/profile")({
  component: ProfileLayout,
});

type NavItem = {
  titleKey: MessageKey;
  icon: LucideIcon;
  /** omitted while the page isn't built yet; the item renders disabled */
  to?: "/profile" | "/profile/sign-in" | "/profile/sessions" | "/profile/organizer" | "/profile/delete" | "/dashboard" | "/tickets";
  exact?: boolean;
  /** hidden for this role */
  hiddenForRole?: string[];
  /** shown only to these roles */
  onlyForRoles?: string[];
  destructive?: boolean;
  /** items in different groups are divided by a separator */
  group: number;
};

const navItems: NavItem[] = [
  { titleKey: "account.profile.layout.nav.account", to: "/profile", icon: UserRound, exact: true, group: 0 },
  { titleKey: "account.profile.layout.nav.tickets", to: "/tickets", icon: Ticket, group: 0 },
  { titleKey: "account.profile.layout.nav.signIn", to: "/profile/sign-in", icon: LockKeyhole, group: 1 },
  { titleKey: "account.profile.layout.nav.sessions", to: "/profile/sessions", icon: MonitorSmartphone, group: 1 },
  { titleKey: "account.profile.layout.nav.dashboard", to: "/dashboard", icon: LayoutDashboard, onlyForRoles: ["organizer", "admin"], group: 2 },
  { titleKey: "account.profile.layout.nav.organizer", to: "/profile/organizer", icon: CalendarPlus, hiddenForRole: ["organizer", "admin"], group: 2 },
  { titleKey: "account.profile.layout.nav.delete", to: "/profile/delete", icon: Trash2, destructive: true, group: 3 },
];

const itemClass = (item: NavItem) =>
  cn(buttonVariants({ variant: "ghost" }), "justify-start", item.destructive && "text-destructive hover:text-destructive");

function SoonBadge() {
  const t = useT();
  return (
    <Badge variant="outline" className="ml-auto">
      {t("account.profile.layout.soon")}
    </Badge>
  );
}

function ProfileLayout() {
  const t = useT();
  const guarded = Route.useRouteContext().session;
  const { data: session } = useSession();
  const role = (session?.user ?? guarded.user).role;
  const pathname = useRouterState({ select: (state) => state.location.pathname.replace(/\/$/, "") });
  const items = navItems.filter(
    (item) => !item.hiddenForRole?.includes(role ?? "") && (!item.onlyForRoles || item.onlyForRoles.includes(role ?? "")),
  );
  const current = items.find((item) => item.to === pathname) ?? items[0];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 py-6">
      <PageHeader size="lg" title={t("account.profile.layout.title")} description={t("account.profile.layout.description")} />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        {/* mobile: one full-width dropdown instead of a sideways-scrolling strip */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="lg" className="w-full justify-between md:hidden" />}
            aria-label={t("account.profile.layout.menuLabel")}
          >
            <span className="flex items-center gap-2">
              <current.icon data-icon="inline-start" />
              {t(current.titleKey)}
            </span>
            <ChevronsUpDown data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-56">
            {items.map((item, index) => (
              <Fragment key={item.titleKey}>
                {index > 0 && items[index - 1].group !== item.group && <DropdownMenuSeparator />}
                {item.to ? (
                  <DropdownMenuItem variant={item.destructive ? "destructive" : "default"} render={<Link to={item.to} />}>
                    <item.icon />
                    {t(item.titleKey)}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled>
                    <item.icon />
                    {t(item.titleKey)}
                    <SoonBadge />
                  </DropdownMenuItem>
                )}
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <nav aria-label={t("account.profile.layout.menuLabel")} className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:gap-1 md:sticky md:top-21">
          {items.map((item, index) => (
            <Fragment key={item.titleKey}>
              {index > 0 && items[index - 1].group !== item.group && <Separator className="my-1" />}
              {item.to ? (
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.exact }}
                  className={itemClass(item)}
                  activeProps={{ className: item.destructive ? "bg-destructive/10 font-semibold text-destructive" : "bg-secondary font-semibold text-primary dark:text-chart-2" }}
                >
                  <item.icon data-icon="inline-start" />
                  {t(item.titleKey)}
                </Link>
              ) : (
                <span aria-disabled="true" className={cn(itemClass(item), "pointer-events-none opacity-60")}>
                  <item.icon data-icon="inline-start" />
                  {t(item.titleKey)}
                  <SoonBadge />
                </span>
              )}
            </Fragment>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
