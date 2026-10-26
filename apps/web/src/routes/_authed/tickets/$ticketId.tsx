import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft, CalendarClock, ExternalLink, MapPin, ReceiptText, TicketX,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { TicketStub } from "@/components/ticket-stub";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { ticketQueryOptions } from "@/lib/enrollments";
import { hasEnded } from "@/lib/events";
import { formatDateRange } from "@/lib/format";
import { kindInfo } from "@/lib/ticket-types";

export const Route = createFileRoute("/_authed/tickets/$ticketId")({ component: TicketPage });

// black on white whatever the theme, so scanners read it
const QR = { level: "M", fgColor: "#0a0a0a", bgColor: "#ffffff" } as const;

function TicketPage() {
  const t = useT();
  const { ticketId } = Route.useParams();
  const { data: ticket, isPending, isError } = useQuery(ticketQueryOptions(ticketId));
  usePageTitle(ticket ? t("common.pageTitle.ticket", { event: ticket.event.title }) : undefined);

  const back = (
    <Link to="/tickets" className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}>
      <ArrowLeft data-icon="inline-start" />
      {t("account.tickets.back")}
    </Link>
  );

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-4" aria-busy="true" aria-label={t("account.tickets.detail.loading")}>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-[32rem]" />
      </div>
    );
  }
  if (isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TicketX />
          </EmptyMedia>
          <EmptyTitle>{t("account.tickets.detail.notFound.title")}</EmptyTitle>
          <EmptyDescription>{t("account.tickets.detail.notFound.description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{back}</EmptyContent>
      </Empty>
    );
  }

  const { event } = ticket;
  const { icon: KindIcon } = kindInfo[ticket.ticketType.kind];

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-4">
      {back}
      {/* the ticket: the event on ink above the tear, the code on white below it. The QR stays black on white, away from every decoration, so a scanner reads it. */}
      <TicketStub
        vertical
        stub={
          <div className="relative isolate overflow-hidden bg-dusk text-dusk-foreground">
            {event.thumbnailUrl && (
              <>
                <img src={event.thumbnailUrl} alt="" className="absolute inset-0 -z-10 size-full object-cover opacity-60" />
                <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-t from-dusk via-dusk/80 to-dusk/30" />
              </>
            )}
            <div className="flex flex-col gap-4 p-6 pt-16 pb-9">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-sun px-3 py-1 text-sm font-bold text-sun-foreground">
                  <KindIcon className="size-4" />
                  {ticket.ticketType.name}
                </span>
                {hasEnded(event) && <span className="rounded-full border border-dusk-foreground/40 px-3 py-1 text-sm">{t("account.tickets.detail.ended")}</span>}
              </div>
              <h1 className="text-3xl leading-[1.25] font-bold tracking-tight text-balance">{event.title}</h1>
              <p className="flex items-start gap-2 text-base text-dusk-foreground/90">
                <CalendarClock className="mt-1 size-4 shrink-0 text-sun" />
                {formatDateRange(event.startsAt, event.endsAt)}
              </p>
              <p className="flex items-start gap-2 text-base text-dusk-foreground/90">
                <MapPin className="mt-1 size-4 shrink-0 text-sun" />
                {event.venue}
              </p>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-6 px-6 pt-9 pb-6">
          <div className="flex flex-col items-center gap-3">
            <div className="overflow-hidden rounded-md border bg-white p-1">
              <QRCodeSVG value={ticket.code} size={232} marginSize={2} title={t("account.tickets.detail.qrTitle", { name: ticket.firstName })} {...QR} />
            </div>
            <span className="font-mono text-xl font-semibold tracking-[0.3em]">{ticket.code}</span>
            <span className="text-center text-sm text-muted-foreground">{t("account.tickets.detail.qrHint")}</span>
          </div>
          <dl className="flex flex-col gap-3 border-t pt-5 text-sm">
            <Detail label={t("account.tickets.detail.attendee")}>
              {ticket.firstName} {ticket.lastName}
            </Detail>
            <Detail label={t("account.tickets.detail.email")}>
              {ticket.email}
            </Detail>
            {ticket.boughtBy && (
              <Detail label={t("account.tickets.detail.boughtBy")}>
                {ticket.boughtBy.name}
              </Detail>
            )}
          </dl>
          {ticket.answers.length > 0 && (
            <dl className="flex flex-col gap-2 rounded-md bg-muted px-4 py-3 text-sm">
              {ticket.answers.map((answer) => (
                <div key={answer.questionId} className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">{answer.label}</dt>
                  <dd className="break-words whitespace-pre-wrap">{answer.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-col gap-2">
            {/* the order is where its buyer asks for a refund */}
            {ticket.isBuyer && (
              <Link
                to="/tickets/orders/$enrollmentId"
                params={{ enrollmentId: ticket.enrollmentId }}
                className={buttonVariants({ variant: "outline", className: "w-full" })}
              >
                <ReceiptText data-icon="inline-start" />
                {t("account.tickets.detail.viewOrder")}
              </Link>
            )}
            <Link to="/events/$slug" params={{ slug: event.slug }} className={buttonVariants({ variant: "outline", className: "w-full" })}>
              <ExternalLink data-icon="inline-start" />
              {t("account.tickets.detail.viewEvent")}
            </Link>
          </div>
        </div>
      </TicketStub>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
