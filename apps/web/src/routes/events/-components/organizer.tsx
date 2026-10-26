import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck } from "lucide-react";
import { EventThumb } from "@/components/event-parts";
import { UserAvatar } from "@/components/user-avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { publicEventsQueryOptions } from "@/lib/events";
import { useT } from "@/i18n";
import { formatDateRange, formatMonthYear } from "@/lib/format";
import { organizerQueryOptions } from "@/lib/organizers";
import { cn } from "cn";

/** "จัดโดย …" under the event title; jumps to the organizer section further down. */
export function OrganizerByline({ organizerId, tone }: { organizerId: string; tone?: "ink" }) {
  const t = useT();
  const { data: organizer, isPending } = useQuery(organizerQueryOptions(organizerId));
  if (isPending) return <Skeleton className={cn("h-8 w-48", tone === "ink" && "bg-dusk-foreground/15")} />;
  if (!organizer) return null;
  // the name goes in bold wherever the language puts it
  const [before, after] = t("pub.organizer.byline", { name: "\u0001" }).split("\u0001");
  return (
    <a
      href="#organizer"
      className={cn(
        "flex min-h-10 w-fit items-center gap-2 rounded-full text-sm outline-none focus-visible:ring-[3px]",
        tone === "ink"
          ? "text-dusk-foreground/85 hover:text-dusk-foreground focus-visible:ring-sun"
          : "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50",
      )}
    >
      <UserAvatar user={organizer} size="sm" />
      <span>
        {before}
        <span className={cn("font-medium", tone === "ink" ? "text-dusk-foreground" : "text-foreground")}>{organizer.name}</span>
        {after}
      </span>
    </a>
  );
}

const OTHERS = 3;

/** Who organizes the event, and what else they have coming up. */
export function OrganizerSection({ organizerId, eventId }: { organizerId: string; eventId: string }) {
  const t = useT();
  const { data: organizer, isPending } = useQuery(organizerQueryOptions(organizerId));
  // one more than shown, in case this event is among them
  const { data: upcoming } = useQuery(publicEventsQueryOptions({ organizerId, pageSize: OTHERS + 1 }));
  const others = (upcoming?.items ?? []).filter((event) => event.id !== eventId).slice(0, OTHERS);

  if (isPending) return <Skeleton className="h-24" />;
  if (!organizer) return null;

  return (
    <section id="organizer" className="flex scroll-mt-24 flex-col gap-4" aria-labelledby="organizer-heading">
      <h2 id="organizer-heading" className="text-xl font-bold">
        {t("pub.organizer.heading")}
      </h2>
      <Card>
        <CardContent className="flex flex-col gap-6">
          {/* phones: the button drops below, so the name keeps the full width */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <UserAvatar user={organizer} className="size-14 shrink-0 text-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="flex items-center gap-1.5 text-lg font-semibold">
                  <span className="truncate">{organizer.name}</span>
                  {organizer.organizerSince && (
                    <BadgeCheck className="size-5 shrink-0 text-primary dark:text-chart-2" aria-label={t("pub.organizer.approved")} />
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {organizer.organizerSince
                    ? t("pub.organizer.since", { date: formatMonthYear(organizer.organizerSince) })
                    : t("pub.organizer.plain")}
                  {upcoming && upcoming.total > 0 && ` · ${t("pub.organizer.upcoming", { n: upcoming.total })}`}
                </p>
              </div>
            </div>
            {/* only worth a link when there's more than this event */}
            {others.length > 0 && (
              <Link
                to="/events"
                search={{ organizer: organizer.id }}
                className={buttonVariants({ variant: "outline", size: "sm", className: "self-start sm:self-auto" })}
              >
                {t("pub.organizer.viewAll")}
                <ArrowRight data-icon="inline-end" />
              </Link>
            )}
          </div>

          {others.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">{t("pub.organizer.others")}</h3>
              <ul className="flex flex-col divide-y">
                {others.map((event) => (
                  <li key={event.id}>
                    <Link
                      to="/events/$slug"
                      params={{ slug: event.slug }}
                      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 hover:bg-muted"
                    >
                      <EventThumb event={event} className="aspect-video w-20" />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{event.title}</span>
                        <span className="truncate text-sm text-muted-foreground">
                          {formatDateRange(event.startsAt, event.endsAt)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
