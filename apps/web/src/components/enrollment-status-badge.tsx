import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n";
import { enrollmentStatusInfo, type EnrollmentStatus } from "@/lib/enrollments";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The status, and the payment deadline while it waits for payment. */
export function EnrollmentStatusBadge({
  enrollment,
  className,
}: {
  enrollment: { status: EnrollmentStatus; expiresAt: string | null };
  className?: string;
}) {
  const t = useT();
  const { label, icon: Icon, variant } = enrollmentStatusInfo[enrollment.status];
  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <Badge variant={variant}>
        <Icon data-icon="inline-start" />
        {label}
      </Badge>
      {enrollment.status === "awaiting_payment" && enrollment.expiresAt && (
        <span className="text-xs whitespace-nowrap text-muted-foreground">{t("shared.enrollmentStatus.payBy", { date: formatDateTime(enrollment.expiresAt) })}</span>
      )}
    </div>
  );
}
