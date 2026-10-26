import { cn } from "cn";

/**
 * A ticket drawn as two pieces: `stub` (the short piece, usually a price or a date) and `children` (the rest), torn along a
 * dashed line. Horizontal by default; `vertical` stacks them, for a ticket shown on its own. Only decoration: the pieces are
 * ordinary blocks, so content, focus and selection behave as in any card.
 */
export function TicketStub({
  stub,
  children,
  vertical,
  stubClassName,
  stubStyle,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  stub: React.ReactNode;
  children: React.ReactNode;
  vertical?: boolean;
  stubClassName?: string;
  /** the stub's own ground, e.g. a category's colourway; it wins over the card fill */
  stubStyle?: React.CSSProperties;
}) {
  return (
    <div data-slot="ticket-stub" className={cn(vertical ? "ticket-v" : "ticket-h", className)} {...props}>
      <div className={cn("shrink-0 bg-card", vertical ? "rounded-t-md" : "min-w-28 max-w-[44%] rounded-l-md sm:min-w-36", stubClassName)} style={stubStyle}>
        {stub}
      </div>
      <div className={cn("min-w-0 flex-1 bg-card", vertical ? "rounded-b-md" : "rounded-r-md")}>{children}</div>
    </div>
  );
}
