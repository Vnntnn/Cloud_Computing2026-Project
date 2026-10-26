import { CalendarCog, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import type { Role } from "@app/auth-guard/permissions";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n";
import { roleLabels } from "@/lib/roles";

const roleStyles: Record<Role, { icon: LucideIcon; variant: "secondary" | "outline" | "default" }> = {
  user: { icon: UserRound, variant: "secondary" },
  organizer: { icon: CalendarCog, variant: "outline" },
  admin: { icon: ShieldCheck, variant: "default" },
};

// `role` here is the Eventide role, not the ARIA attribute
export function RoleBadge({
  role,
  ...props
}: Omit<React.ComponentProps<typeof Badge>, "role"> & { role?: string | null }) {
  useT(); // re-render on a language switch: the labels read the current language
  const key: Role = role === "organizer" || role === "admin" ? role : "user";
  const { icon: Icon, variant } = roleStyles[key];
  return (
    <Badge data-slot="role-badge" variant={variant} {...props}>
      <Icon data-icon="inline-start" />
      {roleLabels[key]}
    </Badge>
  );
}
