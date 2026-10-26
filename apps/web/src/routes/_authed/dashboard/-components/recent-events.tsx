import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { EventThumb } from "@/components/event-parts";
import { EventStatusBadge } from "@/components/event-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { myEventsQueryOptions, statusInfo, type EventStatus } from "@/lib/events";
import { formatDateRange } from "@/lib/format";
import { NoEventsYet } from "./no-events-yet";

/** The five most recently edited events, or the first-event prompt. */
export function RecentEvents({ title }: { title: string }) {
  const t = useT();
  const { data, isPending } = useQuery(myEventsQueryOptions({ page: 1, pageSize: 5 }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {t("dashboard.overview.recent.lastEdited")}
          {/* how the events stand, from the counts the list already returns (zeros left out) */}
          {data &&
            (Object.keys(data.counts) as EventStatus[])
              .filter((status) => data.counts[status] > 0)
              .map((status) => ` · ${statusInfo[status].label} ${data.counts[status]}`)
              .join("")}
        </CardDescription>
        {!!data?.total && (
          <CardAction>
            <Link to="/dashboard/events" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t("dashboard.overview.recent.viewAll", { total: data.total })}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <NoEventsYet />
        ) : (
          <ul className="flex flex-col divide-y">
            {data.items.map((event) => (
              <li key={event.id}>
                <Link
                  to="/dashboard/events/$eventId"
                  params={{ eventId: event.id }}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 hover:bg-muted"
                >
                  <EventThumb event={event} className="aspect-video w-16" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{event.title}</span>
                    <span className="text-sm text-muted-foreground sm:truncate">
                      {formatDateRange(event.startsAt, event.endsAt)}
                    </span>
                  </div>
                  <EventStatusBadge status={event.status} publishAt={event.publishAt} className="shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
