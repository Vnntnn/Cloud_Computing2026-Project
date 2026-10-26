import { Link } from "@tanstack/react-router";
import { CalendarPlus, CalendarX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/i18n";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function NoEventsYet() {
  const t = useT();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarX />
        </EmptyMedia>
        <EmptyTitle>{t("dashboard.noEvents.title")}</EmptyTitle>
        <EmptyDescription>{t("dashboard.noEvents.description")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/dashboard/events/new" className={buttonVariants()}>
          <CalendarPlus data-icon="inline-start" />
          {t("dashboard.noEvents.create")}
        </Link>
      </EmptyContent>
    </Empty>
  );
}
