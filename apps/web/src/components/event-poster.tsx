import { DateTicket } from "@/components/date-ticket";
import { useLocale } from "@/i18n";
import { categoryName } from "@/lib/category-name";
import { formatDay, formatMonth } from "@/lib/format";
import { colourwayOf, layoutOf } from "@/lib/poster";
import { cn } from "cn";

type PosterEvent = { id: string; startsAt: string; category: { slug: string; name: string; nameEn?: string | null } };

/** Five tide lines, the logo's waves, run across the poster. They are the only texture. */
export function Tide({ color, className }: { color: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 100 60" preserveAspectRatio="none" className={cn("absolute inset-x-0 h-3/5 w-full fill-none", className)} stroke={color} strokeWidth="1.2">
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M-5 ${14 + i * 9} Q 20 ${4 + i * 9} 45 ${14 + i * 9} T 95 ${14 + i * 9} T 145 ${14 + i * 9}`} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/**
 * The cover of an event that has no photograph: its date, set as a poster. The colourway is the category's and
 * the layout is the event's, so a list of them reads as one family. The words are drawn for looks only; the date
 * and category are always written out beside it, which is why it is hidden from assistive technology.
 * `layout` fixes the arrangement (the billboard needs the numeral at the top right); `bare` leaves out the category and
 * month so the caller can set its own words on the poster. `ticket` sets the date on a ticket (DateTicket) in place of the big numeral;
 * the ticket tears when the card around the poster is hovered.
 */
export function EventPoster({ event, className, layout: fixed, bare, ticket, children }: { event: PosterEvent; className?: string; layout?: 0 | 1 | 2; bare?: boolean; ticket?: boolean; children?: React.ReactNode }) {
  const locale = useLocale();
  const colourway = colourwayOf(event.category.slug);
  const layout = fixed ?? layoutOf(event.id);
  const text = colourway.tone === "dark" ? "text-dusk-foreground" : "text-sun-foreground";
  const day = ticket ? (
    <DateTicket
      value={event.startsAt}
      slug={event.category.slug}
      size="poster"
      className={cn(
        "absolute z-10",
        layout === 0 && "bottom-[8cqmin] left-[8cqmin]",
        layout === 1 && "top-[8cqmin] right-[8cqmin]",
        layout === 2 && "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
      )}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "absolute block leading-[0.78] font-bold tracking-tighter tabular-nums",
        layout === 0 && "-bottom-[9cqmin] -left-[3cqmin] text-[80cqmin]",
        layout === 1 && "-top-[12cqmin] -right-[3cqmin] text-[66cqmin]",
        layout === 2 && "top-1/2 left-1/2 -translate-x-1/2 -translate-y-[44%] text-[72cqmin]",
      )}
      style={{ color: colourway.ink }}
    >
      {formatDay(event.startsAt)}
    </span>
  );

  return (
    <div className={cn("relative isolate overflow-hidden [container-type:size]", text, className)} style={{ background: colourway.ground }}>
      <div aria-hidden className="contents">
        <Tide color={colourway.ink} className={cn("opacity-40", layout === 1 ? "top-0 -scale-y-100" : "bottom-0")} />
        {day}
        {!bare && (
          <>
            <span className={cn("absolute z-10 hidden max-w-[70%] truncate text-[6cqmin] leading-tight font-bold @min-[9rem]:block", layout === 1 ? "bottom-[5cqmin] left-[5cqmin]" : "top-[5cqmin] left-[5cqmin]")}>
              {categoryName(event.category, locale)}
            </span>
            <span className={cn("absolute z-10 hidden text-[6cqmin] leading-tight font-bold @min-[9rem]:block", layout === 1 ? "bottom-[5cqmin] right-[5cqmin]" : "top-[5cqmin] right-[5cqmin]")}>
              {formatMonth(event.startsAt)}
            </span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

/** A category's colourway as a small chip: its ground and the wave lines in its ink. */
export function CategoryChip({ slug, className }: { slug: string; className?: string }) {
  const { ground, ink } = colourwayOf(slug);
  return (
    <span aria-hidden className={cn("relative block shrink-0 overflow-hidden rounded-[4px] ring-1 ring-current/40", className)} style={{ background: ground }}>
      <Tide color={ink} className="inset-y-auto top-1/4 h-full opacity-90" />
    </span>
  );
}
