import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, CalendarDays, MapPin } from "lucide-react";
import { DateBlock, HourRuler, Kind, LiveMark } from "@/components/event-parts";
import { CategoryChip, EventPoster } from "@/components/event-poster";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/i18n";
import { isLive, type Category, type EventSummary } from "@/lib/events";
import { formatDateRange, formatTime } from "@/lib/format";
import { colourwayOf } from "@/lib/poster";
import { cn } from "cn";

const focus = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The first of the events below the hero, set big: the cover on the left, and on the right the words, with the kind at the
 * top of the cover's height and the date, place and the way in at the bottom of it. Without a photograph the cover is a
 * poster with the title set on it; with one, the title sits in the words. Stacked on a phone.
 */
export function Billboard({ event, level = 3 }: { event: EventSummary; level?: 2 | 3 }) {
  const t = useT();
  // the heading level follows the page: under a section heading it is an h3, straight under the page title (listings) an h2
  const Heading = level === 2 ? "h2" : "h3";
  const title = (
    <Heading
      className={cn(
        "font-bold tracking-tight text-balance decoration-2 underline-offset-8 group-hover:underline group-focus-visible:underline",
        event.thumbnailUrl ? "text-4xl leading-[1.2] sm:text-5xl sm:leading-[1.2]" : "line-clamp-4 text-[10cqmin] leading-[1.2]", // on a poster the title scales with the poster, so it keeps clear of the numeral at any width
      )}
    >
      {event.title}
    </Heading>
  );
  return (
    <Link to="/events/$slug" params={{ slug: event.slug }} className={cn("group grid gap-6 rounded-sm lg:grid-cols-[7fr_5fr] lg:gap-12", focus)}>
      <div data-cursor={t("common.cursor.view")} className="relative aspect-[5/4] overflow-hidden rounded-sm bg-muted sm:aspect-[4/3] lg:aspect-[16/9]">
        {event.thumbnailUrl ? (
          <img src={event.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]" />
        ) : (
          <EventPoster event={event} layout={1} bare className="size-full">
            <div className="absolute inset-x-0 bottom-0 z-10 p-5 pr-[34%] sm:p-7 sm:pr-[34%]">{title}</div>
          </EventPoster>
        )}
        {isLive(event) && (
          <div className="absolute bottom-3 left-3 z-10">
            <LiveMark />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-6 lg:justify-center">
        {event.thumbnailUrl && (
          <div className="flex flex-col gap-4">
            <Kind category={event.category} className="text-muted-foreground" />
            {title}
          </div>
        )}
        {/* the details sit at the foot of the cover's height, like a caption; an event with a poster has its title on the cover, so its kind joins them */}
        <div className="flex flex-col gap-5 lg:border-t lg:pt-6">
          {!event.thumbnailUrl && <Kind category={event.category} className="text-muted-foreground" />}
          <HourRuler start={event.startsAt} end={event.endsAt} slug={event.category.slug} className="max-w-sm" />
          <div className="flex flex-col gap-1.5 text-base text-muted-foreground">
            <p className="flex items-start gap-2">
              <CalendarDays className="mt-1 size-4 shrink-0" />
              {formatDateRange(event.startsAt, event.endsAt)}
            </p>
            <p className="flex items-start gap-2">
              <MapPin className="mt-1 size-4 shrink-0" />
              <span className="line-clamp-2">{event.venue}</span>
            </p>
          </div>
          <span className={cn(buttonVariants({ size: "lg" }), "pointer-events-none w-fit")}>
            {t("pub.home.upcoming.view")}
            <ArrowRight data-icon="inline-end" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * The rest, as a ledger under the billboard: two columns on a wide screen (one when there is a single row), each row a
 * date block in the category's colourway, the event, and an arrow. An event with a photograph shows it before the arrow
 * (a poster would only repeat the date).
 */
export function Ledger({ events }: { events: EventSummary[] }) {
  return (
    <ol className="grid gap-x-12 border-b lg:grid-cols-2 lg:has-[li:only-child]:grid-cols-1">
      {events.map((event) => (
        <li key={event.id} className="rise-in border-t">
          <Link
            to="/events/$slug"
            params={{ slug: event.slug }}
            className={cn(
              "group grid items-center gap-x-4 rounded-sm px-1 py-6 transition-colors duration-300 hover:bg-muted/60 sm:gap-x-6",
              event.thumbnailUrl ? "grid-cols-[5.5rem_1fr_4rem_auto] sm:grid-cols-[6.5rem_1fr_5rem_auto]" : "grid-cols-[5.5rem_1fr_auto] sm:grid-cols-[6.5rem_1fr_auto]",
              focus,
            )}
          >
            <DateBlock value={event.startsAt} slug={event.category.slug} className="py-3" />
            <span className="flex min-w-0 flex-col gap-1.5">
              <Kind category={event.category} className="text-muted-foreground" />
              <span className="line-clamp-2 text-xl leading-snug font-bold group-hover:underline group-focus-visible:underline sm:text-2xl sm:leading-snug">{event.title}</span>
              <span className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                {/* only the venue gives way; the time is information and never truncates */}
                <span className="line-clamp-1 min-w-0">{event.venue}</span>
                <span className="shrink-0 tabular-nums">· {formatTime(event.startsAt)}</span>
              </span>
            </span>
            {event.thumbnailUrl && (
              <span className="relative aspect-[4/5] overflow-hidden rounded-sm bg-muted">
                <img src={event.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 ease-out-expo group-hover:scale-110" />
              </span>
            )}
            <ArrowRight className="size-5 text-muted-foreground transition-transform duration-300 ease-out-expo group-hover:translate-x-1 group-hover:text-foreground" />
          </Link>
        </li>
      ))}
    </ol>
  );
}

/**
 * The categories as an index set in type, one row each, each with a chip in its own colourway. A row also fills with that
 * colour on hover and focus, the colour the category's posters wear everywhere else.
 */
export function KindIndex({ categories }: { categories: Category[] }) {
  return (
    <ul className="grid gap-x-12 lg:grid-cols-2">
      {categories.map((c) => {
        const { ground, ink, tone } = colourwayOf(c.slug);
        return (
          <li key={c.id} className="border-t border-current/20 max-lg:last:border-b lg:[&:nth-last-child(-n+2)]:border-b">
            <Link
              to="/events/categories/$category"
              params={{ category: c.slug }}
              style={{ "--g": ground, "--i": ink } as React.CSSProperties}
              className={cn(
                "group flex items-center gap-4 rounded-sm px-2 py-4 outline-none transition-colors duration-300 sm:gap-6 sm:px-4 sm:py-5",
                "hover:bg-(--g) focus-visible:bg-(--g) focus-visible:ring-[3px] focus-visible:ring-ring/60",
                tone === "dark" ? "hover:text-dusk-foreground focus-visible:text-dusk-foreground" : "hover:text-sun-foreground focus-visible:text-sun-foreground",
              )}
            >
              <CategoryChip slug={c.slug} className="h-10 w-14 sm:h-12 sm:w-[4.5rem]" />
              <span className="line-clamp-2 min-w-0 flex-1 text-4xl leading-[1.2] font-bold tracking-tight sm:text-5xl sm:leading-[1.2] lg:text-6xl lg:leading-[1.2]">{c.name}</span>
              <ArrowUpRight className="size-7 shrink-0 transition-transform duration-300 ease-out-expo group-hover:translate-x-1 group-hover:-translate-y-1 group-focus-visible:translate-x-1 group-focus-visible:-translate-y-1 sm:size-9" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
