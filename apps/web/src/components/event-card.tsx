import { Link } from "@tanstack/react-router";
import { CalendarDays, MapPin } from "lucide-react";
import { DateBlock, Kind, LiveMark } from "@/components/event-parts";
import { EventPoster } from "@/components/event-poster";
import { useT } from "@/i18n";
import { isLive, type EventSummary } from "@/lib/events";
import { formatDateRange } from "@/lib/format";

/**
 * An event in a list: its cover over its words. A photograph gets the date as a block in the category's colourway over
 * its corner; an event without one gets a poster, whose picture is the date, so it gets no block. Everything under the cover
 * is the same for both. Cards rise into place as the page is scrolled to them (`rise-in`), and the pointer over a cover says "view".
 */
export function EventCard({ event }: { event: EventSummary }) {
  const t = useT();
  return (
    <Link
      to="/events/$slug"
      params={{ slug: event.slug }}
      className="rise-in group flex flex-col gap-4 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div data-cursor={t("common.cursor.view")} className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-sm bg-muted">
        {event.thumbnailUrl ? (
          <>
            <img
              src={event.thumbnailUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]"
            />
            <DateBlock value={event.startsAt} slug={event.category.slug} compact className="absolute top-3 left-3 h-[4.5rem] w-16 shadow-md" />
          </>
        ) : (
          <EventPoster event={event} bare className="absolute inset-0 transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]" />
        )}
        {isLive(event) && (
          <div className="absolute right-3 bottom-3 z-10">
            <LiveMark />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Kind category={event.category} className="text-muted-foreground" />
        <h2 className="line-clamp-2 text-xl leading-snug font-bold group-hover:underline group-focus-visible:underline">{event.title}</h2>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CalendarDays className="mt-0.5 size-4 shrink-0" />
          {formatDateRange(event.startsAt, event.endsAt)}
        </p>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0" />
          <span className="line-clamp-1">{event.venue}</span>
        </p>
      </div>
    </Link>
  );
}
