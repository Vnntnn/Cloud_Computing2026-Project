import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Ban, CircleCheckBig, LogIn, MailCheck, TicketCheck, TicketX } from "lucide-react";
import { TicketStub } from "@/components/ticket-stub";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { availabilityQueryOptions, type Availability } from "@/lib/enrollments";
import { hasEnded, type EventDetail } from "@/lib/events";
import { formatNumber, formatPrice } from "@/lib/format";
import { useLiveSeats } from "@/lib/live-seats";
import { colourwayOf } from "@/lib/poster";
import { useSession } from "@/lib/session";
import { kindInfo, ticketTypesQueryOptions, type TicketType } from "@/lib/ticket-types";
import { cn } from "cn";

/** The event page's ticket list: price, seats left, and what the viewer can do with each type. */
export function EventTickets({ event }: { event: EventDetail }) {
  const t = useT();
  const { data: types, isPending } = useQuery(ticketTypesQueryOptions(event.id));
  const { data: availability } = useQuery(availabilityQueryOptions(event.id));
  useLiveSeats(event.id);

  return (
    <section id="tickets" className="flex scroll-mt-24 flex-col gap-5" aria-labelledby="tickets-heading">
      <h2 id="tickets-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
        {t("pub.tickets.heading")}
      </h2>
      {isPending ? (
        <Skeleton className="h-32" />
      ) : !types?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TicketX />
            </EmptyMedia>
            <EmptyTitle>{t("pub.tickets.empty.title")}</EmptyTitle>
            <EmptyDescription>{t("pub.tickets.empty.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-4">
          {types.map((type) => (
            <TicketOption
              key={type.id}
              event={event}
              ticketType={type}
              availability={availability?.find((a) => a.ticketTypeId === type.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TicketOption({
  event,
  ticketType,
  availability,
}: {
  event: EventDetail;
  ticketType: TicketType;
  availability: Availability | undefined;
}) {
  const t = useT();
  const { icon: KindIcon, label } = kindInfo[ticketType.kind];
  // the stub wears the category's colourway, like the event's poster and chip: a ticket belongs to its kind of event
  const { ground, ink, tone } = colourwayOf(event.category.slug);
  const remaining = availability?.remaining;
  // not counted in `remaining`; they come back if the payment doesn't arrive in time
  const reserved = availability?.reserved ?? 0;

  return (
    <li>
      <TicketStub
        className={hasEnded(event) ? "opacity-80" : undefined}
        stubClassName="w-32 sm:w-40"
        stubStyle={{ background: ground }}
        stub={
          <div className={cn("flex h-full flex-col items-center justify-center gap-0.5 px-3 py-5 text-center", tone === "dark" ? "text-dusk-foreground" : "text-sun-foreground")}>
            <span className="text-2xl leading-tight font-bold whitespace-nowrap tabular-nums sm:text-3xl" style={{ color: ink }}>
              {formatPrice(ticketType.price)}
            </span>
            {ticketType.kind !== "first_come" && (
              <span className="flex items-center gap-1 text-xs font-semibold">
                <KindIcon className="size-3.5" />
                {label}
              </span>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-4 p-5 pl-6 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-lg leading-snug font-bold">{ticketType.name}</span>
            {ticketType.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{ticketType.description}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {/* once the event has ended seats left mean nothing */}
              {!hasEnded(event) && remaining != null && (remaining > 0 || reserved > 0) && (
                <span className={cn(remaining > 0 && remaining <= 10 && "font-semibold text-foreground")}>
                  {remaining > 0
                    ? reserved > 0
                      ? t("pub.tickets.leftReserved", { n: formatNumber(remaining), reserved: formatNumber(reserved) })
                      : t("pub.tickets.left", { n: formatNumber(remaining) })
                    : t("pub.tickets.onlyReserved", { reserved: formatNumber(reserved) })}
                </span>
              )}
              <span>{t("pub.tickets.maxPerUser", { n: ticketType.maxPerUser })}</span>
              {!!availability?.mine && (
                <Link to="/tickets" className="flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline dark:text-chart-2">
                  <CircleCheckBig className="size-4" />
                  {t("pub.tickets.mine", { n: availability.mine })}
                </Link>
              )}
            </div>
          </div>
          <TicketAction event={event} ticketType={ticketType} availability={availability} />
        </div>
      </TicketStub>
    </li>
  );
}

/** The one thing the viewer can do with a ticket type right now, or why they can't. */
function TicketAction({
  event,
  ticketType,
  availability,
}: {
  event: EventDetail;
  ticketType: TicketType;
  availability: Availability | undefined;
}) {
  const t = useT();
  const { data: session } = useSession();
  const disabled = (icon: React.ReactNode, text: string) => (
    <Button variant="outline" disabled className="sm:w-48">
      {icon}
      {text}
    </Button>
  );

  switch (availability?.state) {
    case undefined:
      return <Skeleton className="h-9 sm:w-48" />;
    case "sold_out":
      return disabled(<TicketX data-icon="inline-start" />, t("pub.tickets.action.soldOut"));
    case "limit_reached":
      return disabled(<TicketCheck data-icon="inline-start" />, t("pub.tickets.action.limitReached"));
    case "invitation_used":
      return disabled(<MailCheck data-icon="inline-start" />, t("pub.tickets.action.invitationUsed"));
    case "closed":
      return disabled(<Ban data-icon="inline-start" />, hasEnded(event) ? t("pub.tickets.action.closedEnded") : t("pub.tickets.action.closedNotOpen"));
    case "invite_only":
      // signed out, they may well be invited: signing in tells
      return session ? (
        disabled(<MailCheck data-icon="inline-start" />, t("pub.tickets.action.inviteOnly"))
      ) : (
        <Link
          to="/login"
          search={{ redirect: `/events/${event.slug}` }}
          className={buttonVariants({ variant: "outline", className: "sm:w-48" })}
        >
          <LogIn data-icon="inline-start" />
          {t("pub.tickets.action.loginForInvite")}
        </Link>
      );
    case "open":
      return (
        <Link
          to="/events/$slug/enroll/$ticketTypeId"
          params={{ slug: event.slug, ticketTypeId: ticketType.id }}
          className={buttonVariants({ className: "sm:w-48" })}
        >
          {/* seats held on another visit or device: the enroll page carries on with them */}
          {availability.hold
            ? t("pub.tickets.action.continue")
            : ticketType.kind === "approval"
              ? t("pub.tickets.action.request")
              : ticketType.price > 0
                ? t("pub.tickets.action.buy")
                : t("pub.tickets.action.register")}
          <ArrowRight data-icon="inline-end" />
        </Link>
      );
  }
}
