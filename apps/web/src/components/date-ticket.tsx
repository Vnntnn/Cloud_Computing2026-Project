import { formatDay, formatMonth } from "@/lib/format";
import { colourwayOf } from "@/lib/poster";
import { cn } from "cn";

/**
 * The date of an event drawn as a ticket: the day on one piece and the month on a short stub, with a half-circle notch at each end
 * of the tear and a dashed line along it (the ticket `.ticket-v` draws). It sits on a cover, where the date is also written out
 * beside it, so it is hidden from assistive technology. When the card it sits on (an ancestor `.group`) is hovered or focused the
 * stub tears off along the dashed line and falls away, and it comes back when the pointer leaves: see `.date-ticket` in effects.css.
 * `card`: the small one on a photograph. `poster`: sized in the poster's own units (cqmin), so it scales with the cover.
 */
export function DateTicket({ value, slug = "general", size = "card", className }: { value: string; slug?: string; size?: "card" | "poster"; className?: string }) {
  const { ground, ink } = colourwayOf(slug);
  // the ticket is the category's ink and its words are the category's ground, so it stands out on a poster of that ground and on a photograph alike
  return (
    <span
      aria-hidden
      data-slot="date-ticket"
      data-size={size}
      className={cn("date-ticket ticket-v", className)}
      style={{ "--ticket-fill": ink, "--ticket-ink": ground } as React.CSSProperties}
    >
      <span className="date-ticket-day">{formatDay(value)}</span>
      <span className="date-ticket-stub">{formatMonth(value)}</span>
    </span>
  );
}
