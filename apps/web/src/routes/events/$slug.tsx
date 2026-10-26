import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  Eye,
  LogIn,
  MailCheck,
  MapPin,
  Pencil,
  Receipt,
  UserPlus,
} from "lucide-react";
import { EventHero } from "@/components/event-hero";
import { NotFound, NoticeScene } from "@/components/route-states";
import { HourRuler } from "@/components/event-parts";
import { CategoryChip } from "@/components/event-poster";
import { EventStatusBadge } from "@/components/event-status-badge";
import { ShareEvent } from "@/components/share-event";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { useT } from "@/i18n";
import { eventQueryOptions, eventUrl, hasEnded, isLive, isScheduled, problemCode, statusInfo } from "@/lib/events";
import { formatDateRange, formatDateTime, formatDuration } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
import { OrganizerByline, OrganizerSection } from "./-components/organizer";
import { YourTickets } from "./-components/your-tickets";
import { EventTickets } from "./-components/ticket-types";

export const Route = createFileRoute("/events/$slug")({ component: EventPage });

function EventPage() {
  const t = useT();
  const { slug } = Route.useParams();
  const { data: event, isPending, isError, error } = useQuery(eventQueryOptions(slug));
  const { data: session } = useSession();
  usePageTitle(event?.title);

  if (isPending) {
    return (
      <div className="-m-4 flex flex-col" aria-busy="true">
        <div className="bg-dusk">
          <div className="mx-auto flex min-h-[22rem] max-w-7xl flex-col justify-end gap-4 px-4 pb-12">
            <Skeleton className="h-6 w-40 bg-dusk-foreground/15" />
            <Skeleton className="h-14 w-2/3 bg-dusk-foreground/15" />
            <Skeleton className="h-6 w-1/3 bg-dusk-foreground/15" />
          </div>
        </div>
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (isError) {
    if (problemCode(error) === "INVITE_ONLY") return <InviteOnly slug={slug} email={session?.user.email} />;
    return <NotFound title={t("pub.event.notFound.title")} description={t("pub.event.notFound.description")} />;
  }

  const user = session?.user;
  const canEdit = !!user && (user.id === event.organizerId || hasRole(user, ["admin"]));
  const preview = event.status !== "public" || isScheduled(event);
  const length = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();

  // only the organizer, admins and (for invite-only) invitees reach a page that isn't public; tell them who else can open the link
  const shareNotice =
    event.status === "draft"
      ? t("pub.event.shareNotice.draft")
      : event.status === "invite"
        ? t("pub.event.shareNotice.invite")
        : event.status === "suspended"
          ? t("pub.event.shareNotice.suspended")
          : isScheduled(event) && event.publishAt
          ? t("pub.event.shareNotice.scheduled", { date: formatDateTime(event.publishAt) })
          : undefined;

  const badges = (
    <>
      <span className="flex items-center gap-2 rounded-full bg-dusk-foreground/12 px-3 py-1 text-sm font-semibold">
        <CategoryChip slug={event.category.slug} className="size-4" />
        {event.category.name}
      </span>
      {isLive(event) && <span className="rounded-full bg-sun px-3 py-1 text-sm font-bold text-sun-foreground">{t("pub.event.badge.live")}</span>}
      {hasEnded(event) && <span className="rounded-full border border-dusk-foreground/40 px-3 py-1 text-sm">{t("pub.event.badge.ended")}</span>}
      {preview && (
        <span className="rounded-full bg-background p-0.5">
          <EventStatusBadge status={event.status} publishAt={event.publishAt} />
        </span>
      )}
    </>
  );

  return (
    // the page's own padding is cancelled so the hero runs edge to edge
    <article className="-m-4 flex flex-col">
      <EventHero event={event} badges={badges} byline={<OrganizerByline organizerId={event.organizerId} tone="ink" />} />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 lg:py-14">
        {/* an invitee also opens an invite-only event; they get a welcome instead of the editor's status */}
        {!canEdit && event.status === "invite" && (
          <Alert>
            <MailCheck />
            <AlertTitle>{t("pub.event.invited.title")}</AlertTitle>
            <AlertDescription>{t("pub.event.invited.description")}</AlertDescription>
          </Alert>
        )}
        {canEdit && (
          <Alert>
            <Eye />
            <AlertTitle>
              {preview ? t("pub.event.editor.preview") : t("pub.event.editor.status", { status: statusInfo[event.status].label })}
            </AlertTitle>
            <AlertDescription>
              {event.status === "suspended"
                ? statusInfo.suspended.description
                : isScheduled(event) && event.publishAt
                  ? t("pub.event.editor.publishesAt", { date: formatDateTime(event.publishAt) })
                  : statusInfo[event.status].description}
            </AlertDescription>
            <AlertAction>
              <Link to="/dashboard/events/$eventId" params={{ eventId: event.id }} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Pencil data-icon="inline-start" />
                {t("pub.event.editor.edit")}
              </Link>
            </AlertAction>
          </Alert>
        )}

        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
          <div className="flex min-w-0 flex-col gap-14">
            <EventTickets event={event} />
            <YourTickets eventId={event.id} ended={hasEnded(event)} />

            {event.description ? (
              <section className="flex flex-col gap-4" aria-labelledby="about">
                <h2 id="about" className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {t("pub.event.about")}
                </h2>
                {/* sanitized by the event service on write (apps/event/src/libs/sanitize.ts) */}
                <div className="rich-text max-w-[68ch]" dangerouslySetInnerHTML={{ __html: event.description }} />
              </section>
            ) : (
              <p className="text-muted-foreground">{t("pub.event.noDescription")}</p>
            )}

            <OrganizerSection organizerId={event.organizerId} eventId={event.id} />
          </div>

          <div className="flex flex-col gap-6 lg:sticky lg:top-21">
            <div className="flex flex-col divide-y rounded-md border bg-card">
              <InfoRow icon={CalendarClock} title={t("pub.event.when")}>
                <p className="font-medium">{formatDateRange(event.startsAt, event.endsAt)}</p>
                {length > 0 && <p className="text-muted-foreground">{t("pub.event.duration", { duration: formatDuration(length) })}</p>}
                <HourRuler start={event.startsAt} end={event.endsAt} slug={event.category.slug} className="mt-2" />
              </InfoRow>
              <InfoRow icon={MapPin} title={t("pub.event.where")}>
                <p className="font-medium">{event.venue}</p>
                {event.venueDescription && <p className="whitespace-pre-line text-muted-foreground">{event.venueDescription}</p>}
                {event.venueUrl && (
                  <a
                    href={event.venueUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className={buttonVariants({ variant: "outline", size: "sm", className: "mt-1 self-start" })}
                  >
                    <ExternalLink data-icon="inline-start" />
                    {t("pub.event.openMap")}
                  </a>
                )}
              </InfoRow>
              <InfoRow icon={Receipt} title={t("pub.event.refund.heading")}>
                <p className="text-muted-foreground">
                  {event.isRefundAvailable && event.refundCutoffHours !== null && event.refundPercent !== null
                    ? t("pub.event.refund.available", {
                        percent: event.refundPercent,
                        duration: formatDuration(event.refundCutoffHours * 3_600_000),
                      })
                    : t("pub.event.refund.none")}
                </p>
              </InfoRow>
            </div>
            <ShareEvent title={event.title} url={eventUrl(event.slug)} slug={event.slug} notice={shareNotice} />
          </div>
        </div>
      </div>
    </article>
  );
}

/** One row of the event's facts: an icon and a heading, then whatever the fact needs. */
function InfoRow({ icon: Icon, title, children }: { icon: typeof MapPin; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 p-5 text-sm">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <Icon className="size-5 text-primary dark:text-chart-2" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** An invite-only event the viewer isn't invited to (or can't tell yet, signed out). The service reveals nothing else. */
function InviteOnly({ slug, email }: { slug: string; email: string | undefined }) {
  const t = useT();
  const redirect = `/events/${slug}`;
  return (
    <NoticeScene
      title={t("pub.event.inviteOnly.title")}
      description={email ? t("pub.event.inviteOnly.signedIn", { email }) : t("pub.event.inviteOnly.signedOut")}
    >
      {email ? (
        <Link to="/events" className={buttonVariants({ variant: "sun", size: "xl" })}>
          <ArrowLeft data-icon="inline-start" />
          {t("pub.event.inviteOnly.toBrowse")}
        </Link>
      ) : (
        <>
          <Link to="/login" search={{ redirect }} className={buttonVariants({ variant: "sun", size: "xl" })}>
            <LogIn data-icon="inline-start" />
            {t("pub.event.inviteOnly.login")}
          </Link>
          <Link
            to="/register"
            search={{ redirect }}
            className={buttonVariants({ variant: "inkOutline", size: "xl" })}
          >
            <UserPlus data-icon="inline-start" />
            {t("pub.event.inviteOnly.register")}
          </Link>
        </>
      )}
    </NoticeScene>
  );
}
