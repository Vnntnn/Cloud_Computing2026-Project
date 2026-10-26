import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarX, Clock, MapPin, Search, Telescope } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InkScene } from "@/components/navbar";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { isLive, type EventSummary } from "@/lib/events";
import { formatDay, formatMonth, formatTime } from "@/lib/format";
import { reveal } from "@/lib/reveal";
import { useUpcoming } from "@/lib/upcoming";
import { cn } from "cn";

/** Rings that show on the hero's dark ground in both themes: light, then a dark gap, so they hold on any surface. */
const focus = "outline-none focus-visible:ring-[3px] focus-visible:ring-sun focus-visible:ring-offset-2 focus-visible:ring-offset-dusk";

/**
 * The cover of the home page: a sky full of paper lanterns, the headline over its edge,
 * the search field directly under the headline, and the next events as a programme along the bottom.
 */
export function HomeHero({ onSearch, edge = "sand" }: { onSearch: (query: string) => void; edge?: "sand" | "page" }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const section = useRef<HTMLElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const lamp = useRef({ x: 0, y: 0, tx: 0, ty: 0, raf: 0, on: false });
  useEffect(() => () => cancelAnimationFrame(lamp.current.raf), []);

  // the lantern: the pointer's place, measured on the photograph (the mask lives there), eases into two CSS variables, with no React state
  // and one write per frame while it settles. The CSS ignores them on touch and under reduced motion, so the script does not write them either.
  const settle = () => {
    const l = lamp.current;
    l.x += (l.tx - l.x) * 0.16;
    l.y += (l.ty - l.y) * 0.16;
    section.current?.style.setProperty("--mx", `${l.x}px`);
    section.current?.style.setProperty("--my", `${l.y}px`);
    l.raf = Math.hypot(l.tx - l.x, l.ty - l.y) > 0.5 ? requestAnimationFrame(settle) : 0;
  };
  const carry = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse" || !matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    const box = plate.current?.getBoundingClientRect();
    if (!box || !section.current) return;
    const l = lamp.current;
    l.tx = e.clientX - box.left;
    l.ty = e.clientY - box.top;
    if (!l.on) {
      // arrive where the pointer is, so the pool fades in there instead of sliding in from the last place
      l.x = l.tx;
      l.y = l.ty;
      l.on = true;
      section.current.dataset.lit = "true";
    }
    l.raf ||= requestAnimationFrame(settle);
  };
  const putOut = () => {
    lamp.current.on = false;
    delete section.current?.dataset.lit;
  };

  return (
    <section
      ref={section}
      onPointerMove={carry}
      onPointerLeave={putOut}
      className={cn(
        "lantern canopy relative isolate flex flex-col overflow-hidden bg-dusk text-dusk-foreground lg:min-h-[min(48rem,calc(100svh-4.25rem))]",
        // the next section is sand in light mode and ink in dark mode; with no Upcoming section it is the page ground
        edge === "sand" ? "[--canopy-fill:var(--sand)] dark:[--canopy-fill:var(--dusk)]" : "[--canopy-fill:var(--background)] dark:[--canopy-fill:var(--dusk-mid)]",
      )}
    >
      <InkScene />
      <div ref={plate} aria-hidden className="hero-plate absolute inset-x-0 top-0 -z-10 h-[24rem] lg:inset-y-0 lg:h-auto">
        <img
          src="/art/hero-lanterns-2400.webp"
          srcSet="/art/hero-lanterns-1400.webp 1400w, /art/hero-lanterns-2400.webp 2400w, /art/hero-lanterns.webp 4000w"
          sizes="(min-width: 1024px) 1980px, 990px"
          width={4000}
          height={1549}
          alt=""
          fetchPriority="high"
          decoding="async"
          className="size-full object-cover object-[72%_50%]"
        />
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-10 px-4 pt-[17.5rem] pb-8 lg:justify-center lg:gap-12 lg:pt-16 lg:pb-10">
        <div className="flex flex-col gap-7 lg:gap-8">
          {/* Thai has no word spaces: each phrase is its own block and balances its own lines, so no word is left alone */}
          <h1 className="text-[clamp(2.5rem,0.9rem+5.9vw,6rem)] leading-[1.18] font-bold tracking-tight">
            <span className="reveal block" style={reveal(60)}>
              {t("pub.home.hero.titleLine1")}
            </span>
            <span className="reveal block text-sun" style={reveal(150)}>
              {t("pub.home.hero.titleLine2")}
            </span>
          </h1>
          <p className="reveal max-w-md text-lg text-dusk-foreground/90" style={reveal(230)}>
            {t("pub.home.hero.subtitle")}
          </p>
          <form
            role="search"
            className="reveal max-w-xl"
            style={reveal(300)}
            onSubmit={(e) => {
              e.preventDefault();
              onSearch(search.trim());
            }}
          >
            <InputGroup className="h-14 border-transparent bg-dusk-foreground text-sun-foreground shadow-xl dark:bg-dusk-foreground has-[[data-slot=input-group-control]:focus-visible]:border-sun has-[[data-slot=input-group-control]:focus-visible]:ring-sun/60">
              <InputGroupInput
                enterKeyHint="search"
                className="h-14 pl-5 text-base placeholder:text-sun-foreground/65 md:text-base"
                placeholder={t("pub.home.hero.searchPlaceholder")}
                aria-label={t("pub.home.hero.searchLabel")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <InputGroupAddon align="inline-end" className="pr-2">
                {/* icon-only below sm: the input needs the width for its 16px placeholder (16px stops iOS zooming on focus) */}
                <InputGroupButton
                  type="submit"
                  size="sm"
                  className="h-10 bg-sun text-sun-foreground hover:bg-sun/85 focus-visible:bg-sun-foreground focus-visible:text-sun focus-visible:ring-sun max-sm:w-10 max-sm:px-0 max-sm:has-data-[icon=inline-start]:pl-0 sm:px-5"
                >
                  <Search data-icon="inline-start" />
                  <span className="max-sm:sr-only">{t("pub.home.hero.search")}</span>
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </div>
        <Programme />
      </div>
    </section>
  );
}

/** The next events, as a strip of date, title and place. Loading, empty and failed each have their own row. */
function Programme() {
  const t = useT();
  const { lineup, isPending, unavailable } = useUpcoming();

  return (
    <div className="reveal flex flex-col gap-3" style={reveal(420)}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-bold">{t("pub.home.hero.programme.title")}</h2>
        <Link to="/events" className={`flex items-center gap-1.5 rounded-lg px-1 text-sm font-semibold underline-offset-4 hover:underline ${focus}`}>
          {t("pub.home.upcoming.viewAll")}
          <ArrowRight className="size-4" />
        </Link>
      </div>
      {isPending ? (
        <div aria-hidden className="grid gap-px border-t border-dusk-foreground/25 pt-4 lg:grid-cols-3 lg:gap-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 bg-dusk-foreground/15" />
          ))}
        </div>
      ) : !lineup?.length ? (
        <Link to="/events" search={unavailable ? undefined : { when: "past" }} className={`flex items-center gap-3 rounded-lg border-t border-dusk-foreground/25 pt-4 ${focus}`}>
          {unavailable ? <Telescope className="size-6 text-sun" /> : <CalendarX className="size-6 text-sun" />}
          <span className="font-bold">{unavailable ? t("pub.home.hero.programme.unavailable") : t("pub.home.hero.programme.empty")}</span>
          <span className="flex items-center gap-1.5 text-sm font-semibold underline underline-offset-4">
            {unavailable ? t("pub.home.hero.explore") : t("pub.home.hero.programme.past")}
            <ArrowRight className="size-4" />
          </span>
        </Link>
      ) : (
        <ol className="grid border-t border-dusk-foreground/25 lg:grid-cols-3 lg:gap-6 lg:pt-4">
          {lineup.map((event) => (
            <li key={event.id} className="border-b border-dusk-foreground/15 last:border-b-0 lg:border-b-0">
              <ProgrammeItem event={event} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ProgrammeItem({ event }: { event: EventSummary }) {
  const t = useT();
  const live = isLive(event);
  return (
    <Link to="/events/$slug" params={{ slug: event.slug }} className={`group grid grid-cols-[3.75rem_1fr] items-center gap-x-4 rounded-lg py-3 lg:py-1 ${focus}`}>
      <span className="flex flex-col items-center leading-none">
        <span className="text-5xl font-bold tabular-nums text-sun transition-transform duration-300 ease-out-expo group-hover:-translate-y-0.5">{formatDay(event.startsAt)}</span>
        <span className="mt-1.5 text-xs font-semibold">{formatMonth(event.startsAt)}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="line-clamp-1 text-lg leading-snug font-bold group-hover:underline group-focus-visible:underline">{event.title}</span>
        <span className="flex items-center gap-1.5 text-sm text-dusk-foreground/85">
          <MapPin className="size-3.5 shrink-0" />
          <span className="line-clamp-1">{event.venue}</span>
        </span>
        <span className="flex items-center gap-1.5 text-sm font-medium text-dusk-foreground/85">
          {live ? <span className="size-2 rounded-full bg-sun" /> : <Clock className="size-3.5" />}
          {live ? t("pub.home.hero.programme.live") : formatTime(event.startsAt)}
        </span>
      </span>
    </Link>
  );
}
