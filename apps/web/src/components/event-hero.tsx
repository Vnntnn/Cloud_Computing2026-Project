import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, CalendarDays, Clock, MapPin, Ticket } from "lucide-react";
import { EventPoster } from "@/components/event-poster";
import { InkScene } from "@/components/navbar";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/i18n";
import { hasEnded, type EventDetail } from "@/lib/events";
import { formatDateRange, formatDuration } from "@/lib/format";
import { reveal } from "@/lib/reveal";
import { cn } from "cn";

/**
 * The top of an event's page: the title, when and where, and the way to the tickets, over the ink scene. With a photograph
 * the picture is washed into the ink behind the words (as on the home page); without one the event's date is set as a poster
 * beside them. `badges` and `byline` come from the page, which knows the viewer.
 */
export function EventHero({ event, badges, byline }: { event: EventDetail; badges: React.ReactNode; byline: React.ReactNode }) {
  const t = useT();
  const photo = event.thumbnailUrl;
  const length = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();

  return (
    <section className="canopy relative isolate overflow-hidden bg-dusk text-dusk-foreground">
      <InkScene />
      {photo && (
        <div aria-hidden className="hero-plate absolute inset-x-0 top-0 -z-10 h-[22rem] lg:inset-y-0 lg:right-0 lg:left-auto lg:h-auto lg:w-[64%]">
          <img src={photo} alt="" fetchPriority="high" decoding="async" className="size-full object-cover" />
        </div>
      )}
      <div
        className={cn(
          "mx-auto grid max-w-7xl gap-8 px-4 pb-10 lg:min-h-[26rem] lg:items-end lg:gap-12 lg:pb-14",
          photo ? "pt-6 max-lg:pt-[13rem]" : "pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]",
        )}
      >
        {!photo && (
          // before the words on a phone; beside them on a wide screen
          <EventPoster
            event={event}
            layout={1}
            className="aspect-[16/9] w-full rounded-sm shadow-xl md:max-w-md lg:order-last lg:aspect-[4/5] lg:max-w-[21rem] lg:justify-self-end"
          />
        )}
        <div className={cn("flex min-w-0 flex-col gap-6", photo && "lg:max-w-[52%]")}>
          <Link
            to="/events"
            className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start text-dusk-foreground hover:bg-dusk-foreground/10 hover:text-dusk-foreground focus-visible:ring-sun max-lg:bg-dusk/75" })}
          >
            <ArrowLeft data-icon="inline-start" />
            {t("pub.event.back")}
          </Link>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">{badges}</div>
            <h1 className="reveal text-[clamp(2.25rem,1rem+3.8vw,4.25rem)] leading-[1.2] font-bold tracking-tight text-balance" style={reveal(60)}>
              {event.title}
            </h1>
            {byline}
          </div>
          <ul className="reveal flex flex-col gap-2 text-base text-dusk-foreground/90 sm:text-lg" style={reveal(160)}>
            <li className="flex items-start gap-3">
              <CalendarDays className="mt-1 size-5 shrink-0 text-sun" />
              <span>{formatDateRange(event.startsAt, event.endsAt)}</span>
            </li>
            <li className="flex items-start gap-3">
              <MapPin className="mt-1 size-5 shrink-0 text-sun" />
              <span>{event.venue}</span>
            </li>
            {length > 0 && (
              <li className="flex items-start gap-3">
                <Clock className="mt-1 size-5 shrink-0 text-sun" />
                <span>{t("pub.event.duration", { duration: formatDuration(length) })}</span>
              </li>
            )}
          </ul>
          {!hasEnded(event) && (
            <a
              href="#tickets"
              style={reveal(240)}
              className={buttonVariants({ variant: "sun", size: "xl", className: "reveal w-fit" })}
            >
              <Ticket data-icon="inline-start" />
              {t("pub.event.getTickets")}
              <ArrowDown data-icon="inline-end" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
