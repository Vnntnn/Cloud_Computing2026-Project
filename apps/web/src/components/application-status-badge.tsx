import { BadgeCheck, Ban, Clock, XCircle, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n";
import type { ApplicationStatus } from "@/lib/organizer-applications";

const statuses: Record<
  ApplicationStatus,
  { icon: LucideIcon; variant: "secondary" | "default" | "destructive" | "outline" }
> = {
  pending: { icon: Clock, variant: "secondary" },
  approved: { icon: BadgeCheck, variant: "default" },
  rejected: { icon: XCircle, variant: "destructive" },
  cancelled: { icon: Ban, variant: "outline" },
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useT();
  const { icon: Icon, variant } = statuses[status];
  return (
    <Badge data-slot="application-status-badge" variant={variant}>
      <Icon data-icon="inline-start" />
      {t(`shared.applicationStatus.${status}`)}
    </Badge>
  );
}
