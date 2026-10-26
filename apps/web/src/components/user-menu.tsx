import { Link } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, Ticket, UserRound } from "lucide-react";
import { RoleBadge } from "@/components/role-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import type { SessionUser } from "@/lib/auth-client";
import { useT } from "@/i18n";
import { authErrorMessage } from "@/lib/auth-errors";
import { hasRole, useSignOut } from "@/lib/session";

export function UserMenu({ user }: { user: SessionUser }) {
  const t = useT();
  const signOut = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-lg" className="rounded-full" />}
        aria-label={t("common.userMenu.label")}
      >
        <UserAvatar user={user} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="truncate font-medium text-foreground">{user.name}</span>
            <span className="truncate">{user.email}</span>
            <RoleBadge role={user.role} />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link to="/tickets" />}>
            <Ticket />
            {t("common.userMenu.tickets")}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/profile" />}>
            <UserRound />
            {t("common.userMenu.profile")}
          </DropdownMenuItem>
          {hasRole(user, ["organizer", "admin"]) && (
            <DropdownMenuItem render={<Link to="/dashboard" />}>
              <LayoutDashboard />
              {t("common.userMenu.dashboard")}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            disabled={signOut.isPending}
            onClick={() =>
              signOut.mutate(undefined, {
                onError: (error) => toast.add({ type: "error", title: authErrorMessage(error) }),
              })
            }
          >
            <LogOut />
            {t("common.userMenu.signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
