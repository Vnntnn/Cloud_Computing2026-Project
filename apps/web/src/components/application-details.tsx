import { Building2, CalendarClock, MessageSquareText, MessageSquareWarning, Phone, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Details = {
  organizationName: string;
  contact: string;
  reason: string;
  createdAt: string;
  reviewNote: string | null;
};

/** What an applicant submitted, one labelled row per field; long reasons keep their line breaks. */
export function ApplicationDetails({ application, className }: { application: Details; className?: string }) {
  const t = useT();
  const rows: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Building2, label: t("shared.applicationDetails.organizationName"), value: application.organizationName },
    { icon: Phone, label: t("shared.applicationDetails.contact"), value: application.contact },
    { icon: MessageSquareText, label: t("shared.applicationDetails.reason"), value: application.reason },
    { icon: CalendarClock, label: t("shared.applicationDetails.submittedAt"), value: formatDateTime(application.createdAt) },
    ...(application.reviewNote
      ? [{ icon: MessageSquareWarning, label: t("shared.applicationDetails.reviewNote"), value: application.reviewNote }]
      : []),
  ];

  return (
    <dl data-slot="application-details" className={cn("flex flex-col gap-4", className)}>
      {rows.map(({ icon: Icon, label, value }) => (
        <div key={label} className="flex flex-col gap-1">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <Icon className="size-4" />
            {label}
          </dt>
          <dd className="font-medium break-words whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
