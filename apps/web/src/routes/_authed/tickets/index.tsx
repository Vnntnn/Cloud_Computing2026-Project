import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClock, ChevronRight, Compass, CreditCard, Hourglass, MapPin, QrCode, Ticket } from "lucide-react";
import { cn } from "cn";
import { EnrollmentStatusBadge } from "@/components/enrollment-status-badge";
import { DateBlock } from "@/components/event-parts";
import { TicketStub } from "@/components/ticket-stub";
import { PageHeader } from "@/components/page-header";
import { PayButton } from "@/components/pay-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { myTicketsQueryOptions, type Enrollment, type MyTicket } from "@/lib/enrollments";
import { hasEnded, isLive } from "@/lib/events";
import { formatDateRange, formatPrice } from "@/lib/format";

export const Route = createFileRoute("/_authed/tickets/")({
  staticData: { title: "account.tickets.list.title" }, component: MyTicketsPage });

/** Tickets of one event, in order. */
type EventGroup = { event: MyTicket["event"]; tickets: MyTicket[] };

function groupByEvent(tickets: MyTicket[]) {
  const groups = new Map<string, EventGroup>();
  for (const ticket of tickets) {
    const group = groups.get(ticket.event.id) ?? { event: ticket.event, tickets: [] };
    group.tickets.push(ticket);
    groups.set(ticket.event.id, group);
  }
  return [...groups.values()];
}

function MyTicketsPage() {
  const t = useT();
  const { data, isPending } = useQuery(myTicketsQueryOptions);
  const groups = groupByEvent(data?.tickets ?? []);
  const upcoming = groups.filter((group) => !hasEnded(group.event));
  // most recent first
  const past = groups.filter((group) => hasEnded(group.event)).reverse();
  const orders = data?.orders ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 py-6">
      <PageHeader size="lg" title={t("account.tickets.list.title")} description={t("account.tickets.list.description")} />

      {isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("account.tickets.list.loading")}>
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : orders.length === 0 && groups.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Ticket />
            </EmptyMedia>
            <EmptyTitle>{t("account.tickets.list.empty.title")}</EmptyTitle>
            <EmptyDescription>{t("account.tickets.list.empty.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/events" className={buttonVariants()}>
              <Compass data-icon="inline-start" />
              {t("account.tickets.list.empty.explore")}
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {orders.length > 0 && (
            <Section title={t("account.tickets.list.sections.pending")}>
              {orders.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </Section>
          )}
          <Section title={t("account.tickets.list.sections.upcoming")}>
            {upcoming.length ? (
              upcoming.map((group) => <EventTicketsCard key={group.event.id} group={group} />)
            ) : (
              <p className="text-sm text-muted-foreground">{t("account.tickets.list.noUpcoming")}</p>
            )}
          </Section>
          {past.length > 0 && (
            <Section title={t("account.tickets.list.sections.past")}>
              {past.map((group) => (
                <EventTicketsCard key={group.event.id} group={group} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-t border-foreground/80 pt-4 text-2xl font-bold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-10">{children}</div>
    </section>
  );
}

/** An enrollment still waiting for the organizer or for payment: a ticket whose stub shows what it is waiting for. */
function OrderCard({ order }: { order: Enrollment }) {
  const t = useT();
  const Waiting = order.status === "pending" ? Hourglass : CreditCard;
  return (
    <TicketStub
      stub={
        <div className="flex h-full items-center justify-center py-5">
          <Waiting className="size-8 text-primary dark:text-chart-2" />
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-5 pl-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="line-clamp-2 text-lg font-bold">{order.event.title}</h3>
            <p className="text-sm text-muted-foreground">
              {order.ticketType.name} × {order.quantity} · {formatPrice(order.total)}
            </p>
          </div>
          <EnrollmentStatusBadge enrollment={order} className="items-end" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {order.status === "pending" ? t("account.tickets.list.awaitingApproval") : t("account.tickets.list.payToGetTickets")}
          </span>
          <div className="flex flex-wrap gap-2">
            <Link to="/tickets/orders/$enrollmentId" params={{ enrollmentId: order.id }} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("account.tickets.list.details")}
              <ChevronRight data-icon="inline-end" />
            </Link>
            {order.status === "awaiting_payment" && <PayButton enrollmentId={order.id} size="sm" />}
          </div>
        </div>
      </div>
    </TicketStub>
  );
}

/** One event and the tickets held for it: the event's date and place, then a ticket row for each person. */
function EventTicketsCard({ group }: { group: EventGroup }) {
  const t = useT();
  const { event, tickets } = group;
  const ended = hasEnded(event);
  return (
    <article className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <DateBlock value={event.startsAt} compact className={cn("h-[4.5rem] w-16 shrink-0", ended && "opacity-60")} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xl leading-snug font-bold">
            <Link to="/events/$slug" params={{ slug: event.slug }} className="min-w-0 hover:underline">
              {event.title}
            </Link>
            {isLive(event) && <Badge>{t("account.tickets.list.liveNow")}</Badge>}
          </h3>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CalendarClock className="mt-0.5 size-4 shrink-0" />
            {formatDateRange(event.startsAt, event.endsAt)}
          </p>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" />
            <span className="line-clamp-1">{event.venue}</span>
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-3">
        {tickets.map((ticket, index) => (
          <li key={ticket.id}>
            <Link
              to="/tickets/$ticketId"
              params={{ ticketId: ticket.id }}
              className="group block rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <TicketStub
                className={cn("[--stub-fg:var(--sun-foreground)] [--stub:var(--sand)] dark:[--stub-fg:var(--sun)] dark:[--stub:var(--dusk-mid)]", ended && "opacity-70")}
                stubStyle={{ background: "var(--stub)" }}
                stub={
                  // sand in light mode and lifted ink in dark, so the stub reads against the page and apart from the date block above it; the QR glyph says what opens
                  <div className="flex h-full flex-col items-center justify-center gap-1 py-4 text-(--stub-fg)">
                    <QrCode className="size-8" />
                    {tickets.length > 1 && <span className="text-xs font-semibold tabular-nums">{index + 1} / {tickets.length}</span>}
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
    </article>
  );
}
