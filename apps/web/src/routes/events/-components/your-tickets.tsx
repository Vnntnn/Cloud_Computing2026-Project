import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, QrCode } from "lucide-react";
import { TicketStub } from "@/components/ticket-stub";
import { useT } from "@/i18n";
import { myTicketsQueryOptions } from "@/lib/enrollments";
import { useSession } from "@/lib/session";
import { cn } from "cn";

/**
 * The tickets the viewer owns for this event, bought by them or sent to their email, each a ticket piece that opens its QR. Nothing
 * for a visitor who is signed out or owns none. It reads the same list as "My tickets" (the registration service decides who owns what).
 */
export function YourTickets({ eventId, ended }: { eventId: string; ended: boolean }) {
  const t = useT();
  const { data: session } = useSession();
  const { data } = useQuery({ ...myTicketsQueryOptions, enabled: !!session });
  const mine = (data?.tickets ?? []).filter((ticket) => ticket.event.id === eventId);
  if (!session || mine.length === 0) return null;

  return (
    <section aria-labelledby="your-tickets-heading" className="flex flex-col gap-4">
      <h2 id="your-tickets-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
        {t("pub.tickets.yours.heading")}
      </h2>
      <ul className="flex flex-col gap-3">
        {mine.map((ticket, index) => (
          <li key={ticket.id}>
            <Link
              to="/tickets/$ticketId"
              params={{ ticketId: ticket.id }}
              className="group block rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <TicketStub
                className={cn("[--stub-fg:var(--sun-foreground)] [--stub:var(--sand)] dark:[--stub-fg:var(--sun)] dark:[--stub:var(--dusk-mid)]", ended && "opacity-80")}
                stubStyle={{ background: "var(--stub)" }}
                stub={
                  <div className="flex h-full flex-col items-center justify-center gap-1 py-4 text-(--stub-fg)">
                    <QrCode className="size-8" />
                    {mine.length > 1 && (
                      <span className="text-xs font-semibold tabular-nums">
                        {index + 1} / {mine.length}
                      </span>
                    )}
                  </div>
                }
              >
                <div className="flex items-center gap-3 p-4 pl-6 transition-colors group-hover:bg-muted/50">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base font-semibold">
                      {ticket.firstName} {ticket.lastName}
                    </span>
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {ticket.ticketType.name}
                      {ticket.boughtBy && t("account.tickets.list.boughtBy", { name: ticket.boughtBy.name })}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform duration-300 ease-out-expo group-hover:translate-x-1" />
                </div>
              </TicketStub>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
