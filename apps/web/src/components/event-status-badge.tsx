import { Badge } from "@/components/ui/badge";
import { isScheduled, scheduledInfo, statusInfo, type EventStatus } from "@/lib/events";
import { useT } from "@/i18n";
import { formatDateTime } from "@/lib/format";

type EventStatusBadgeProps = Omit<React.ComponentProps<typeof Badge>, "variant"> & {
  status: EventStatus;
  /** with it, a public event that isn't published yet shows as scheduled */
  publishAt?: string | null;
};

export function EventStatusBadge({ status, publishAt = null, ...props }: EventStatusBadgeProps) {
  const t = useT();
  const scheduled = isScheduled({ status, publishAt });
  const { icon: Icon, label, variant } = scheduled ? scheduledInfo : statusInfo[status];
  return (
    <Badge
      data-slot="event-status-badge"
      variant={variant}
      title={scheduled && publishAt ? t("shared.eventStatus.publishesAt", { date: formatDateTime(publishAt) }) : undefined}
      {...props}
    >
      <Icon data-icon="inline-start" />
      {label}
    </Badge>
  );
}
