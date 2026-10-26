import { CategoryChip, EventPoster } from "@/components/event-poster";
import { useT } from "@/i18n";
import { formatDay, formatMonth, isValidDate } from "@/lib/format";
import { colourwayOf } from "@/lib/poster";
import { cn } from "cn";

/** The category as a small chip in its own colourway (the one its posters and its row in the index use) and its name. */
export function Kind({ category, className }: { category: { slug: string; name: string }; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 text-sm font-semibold", className)}>
      <CategoryChip slug={category.slug} className="size-4" />
      <span className="line-clamp-1">{category.name}</span>
    </span>
  );
}

/** Marks an event that is on now. The dot is still: the word and the colour carry it, and nothing on the page moves without a reason. */
export function LiveMark() {
  const t = useT();
  return (
    <span className="flex items-center gap-1.5 rounded-sm bg-sun px-2 py-0.5 text-xs font-bold text-sun-foreground">
      <span className="size-1.5 rounded-full bg-sun-foreground" />
      {t("shared.eventCard.live")}
    </span>
  );
}

/**
 * The date as a block in the category's colourway: the day in its ink, the month under it. The ledger uses it, and so does
 * an event card over a photograph (`compact`). A generated poster has no block because the day is its picture.
 */
export function DateBlock({ value, slug = "general", compact, className }: { value: string; slug?: string; compact?: boolean; className?: string }) {
  // without a category (the registration service does not send one) the block is the signature night ink
  const { ground, ink, tone } = colourwayOf(slug);
  return (
    <span className={cn("flex flex-col items-center justify-center gap-1.5 rounded-sm leading-none ring-1 ring-foreground/10", className)} style={{ background: ground }}>
      <span className={cn("font-bold tabular-nums", compact ? "text-3xl" : "text-5xl sm:text-6xl")} style={{ color: ink }}>
        {formatDay(value)}
      </span>
      <span className={cn("text-sm font-semibold", tone === "dark" ? "text-dusk-foreground" : "text-sun-foreground")}>{formatMonth(value)}</span>
    </span>
  );
}

/** A small picture of an event for lists and tables: its photograph, or its date as a tiny poster. */
export function EventThumb({
  event,
  className,
}: {
  event: { id: string; startsAt: string; thumbnailUrl: string | null; category: { slug: string; name: string } };
  className?: string;
}) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-sm bg-muted", className)}>
      {event.thumbnailUrl ? <img src={event.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" /> : <EventPoster event={event} layout={2} bare className="size-full" />}
    </div>
  );
}

/**
 * The day as a ruler of 24 hours, with the hours the event runs filled in the category's colour. An event that goes past
 * midnight fills to the end of its first day. Only a picture of the time: the date and hours are always written beside it,
 * so it is hidden from assistive technology.
 */
export function HourRuler({ start, end, slug = "general", className }: { start: string; end: string; slug?: string; className?: string }) {
  if (!isValidDate(start) || !isValidDate(end)) return null;
  const a = new Date(start);
  const b = new Date(end);
  const hours = (d: Date) => d.getHours() + d.getMinutes() / 60;
  const from = hours(a);
  const to = a.toDateString() === b.toDateString() ? Math.max(hours(b), from) : 24;
  const { ground, ink } = colourwayOf(slug);
  return (
    <div aria-hidden className={cn("flex flex-col gap-1.5 text-muted-foreground", className)}>
      <div className="relative h-7">
        {/* on the dark page the darker colourways fall below 3:1, so the span is outlined in its own ink there */}
        <span
          className="absolute top-0 h-4 rounded-sm dark:ring-1 dark:ring-(--ink)"
          style={{ left: `${(from / 24) * 100}%`, width: `max(${((to - from) / 24) * 100}%, 5px)`, background: ground, "--ink": ink } as React.CSSProperties}
        />
        <span className="hour-ruler absolute inset-x-0 bottom-0 h-1.5 opacity-70" />
      </div>
      <span className="flex justify-between text-xs font-medium tabular-nums">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </span>
    </div>
  );
}
