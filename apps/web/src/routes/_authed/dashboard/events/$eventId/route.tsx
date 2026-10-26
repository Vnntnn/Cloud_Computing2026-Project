import { usePageTitle } from "@/hooks/use-page-title";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  CalendarCog,
  CalendarX,
  Copy,
  ExternalLink,
  MailCheck,
  PencilLine,
  ReceiptText,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { EventStatusBadge } from "@/components/event-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { eventQueryOptions, eventUrl, type EventDetail } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { useT, type MessageKey } from "@/i18n";
import { hasRole, useSession } from "@/lib/session";

export const Route = createFileRoute("/_authed/dashboard/events/$eventId")({ component: EventLayout });

type Tab = {
  title: MessageKey;
  icon: LucideIcon;
  to:
    | "/dashboard/events/$eventId"
    | "/dashboard/events/$eventId/tickets"
    | "/dashboard/events/$eventId/invitations"
    | "/dashboard/events/$eventId/participants"
    | "/dashboard/events/$eventId/refunds";
};

const tabs: Tab[] = [
  { title: "eventAdmin.layout.tabs.details", to: "/dashboard/events/$eventId", icon: PencilLine },
  { title: "eventAdmin.layout.tabs.tickets", to: "/dashboard/events/$eventId/tickets", icon: Ticket },
  { title: "eventAdmin.layout.tabs.invitations", to: "/dashboard/events/$eventId/invitations", icon: MailCheck },
  { title: "eventAdmin.layout.tabs.participants", to: "/dashboard/events/$eventId/participants", icon: Users },
  { title: "eventAdmin.layout.tabs.refunds", to: "/dashboard/events/$eventId/refunds", icon: ReceiptText },
];

function EventLayout() {
  const t = useT();
  const { eventId } = Route.useParams();
  const { data: event, isPending, isError } = useQuery(eventQueryOptions(eventId));

  if (isPending) return <LayoutSkeleton />;
  if (isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarX />
          </EmptyMedia>
          <EmptyTitle>{t("eventAdmin.layout.notFound.title")}</EmptyTitle>
          <EmptyDescription>{t("eventAdmin.layout.notFound.description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link to="/dashboard/events" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft data-icon="inline-start" />
            {t("eventAdmin.layout.notFound.back")}
          </Link>
        </EmptyContent>
      </Empty>
    );
  }
  // tabs read the event with useEventDetail(), so they only mount once it has loaded
  return (
    <div className="flex flex-col gap-6">
      <EventHeader event={event} />
      <EventTabs eventId={event.id} eventTitle={event.title} />
      <SuspendedAlert event={event} />
      <Outlet />
    </div>
  );
}

function EventHeader({ event }: { event: EventDetail }) {
  const t = useT();
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(eventUrl(event.slug));
      toast.add({ type: "success", title: t("eventAdmin.layout.header.linkCopied"), description: eventUrl(event.slug) });
    } catch {
      toast.add({ type: "error", title: t("eventAdmin.layout.header.copyFailed") });
    }
  }

  return (
    <header className="flex flex-col gap-3">
      <Link to="/dashboard/events" className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}>
        <ArrowLeft data-icon="inline-start" />
        {t("eventAdmin.layout.header.allEvents")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-bold">
            <CalendarCog className="size-6 shrink-0 text-primary dark:text-chart-2" />
            <span className="max-sm:line-clamp-2 sm:truncate">{event.title}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <EventStatusBadge status={event.status} publishAt={event.publishAt} />
            <span>{t("eventAdmin.layout.header.lastEdited", { date: formatDateTime(event.updatedAt) })}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={copyLink}>
            <Copy data-icon="inline-start" />
            {t("eventAdmin.layout.header.copyLink")}
          </Button>
          <Link
            to="/events/$slug"
            params={{ slug: event.slug }}
            target="_blank"
            className={buttonVariants({ variant: "outline" })}
          >
            <ExternalLink data-icon="inline-start" />
            {t("eventAdmin.layout.header.viewPage")}
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * One tab per route under the event; the URL picks the active one, so leaving unsaved edits still asks first.
 * Tabs with pages under them (e.g. tickets/new) stay active there; the details tab is the index, so only exactly.
 */
function EventTabs({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const t = useT();
  const matchRoute = useMatchRoute();
  // the tab title carries the event's name ("Attendees · Night Market"); the pages under a tab (a ticket type's editor) set their own
  const exact = tabs.find((tab) => matchRoute({ to: tab.to }));
  usePageTitle(exact ? (exact.to === "/dashboard/events/$eventId" ? eventTitle : `${t(exact.title)} · ${eventTitle}`) : undefined);
  const current = tabs.find((tab) => matchRoute({ to: tab.to, fuzzy: tab.to !== "/dashboard/events/$eventId" }))?.to;
  // on a phone the strip scrolls: bring the active tab into view instead of leaving it half hidden
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    strip.current?.querySelector("[data-active]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [current]);

  return (
    // scrolls sideways on narrow screens; the bottom padding keeps the active underline inside the scroll box
    <nav ref={strip} aria-label={t("eventAdmin.layout.tabsLabel")} className="scroll-hint -mt-2 overflow-x-auto pb-1">
      <Tabs value={current}>
        <TabsList variant="line" className="max-sm:h-11">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.to}
              value={tab.to}
              nativeButton={false}
              render={<Link to={tab.to} params={{ eventId }} />}
            >
              <tab.icon data-icon="inline-start" />
              {t(tab.title)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  );
}

function SuspendedAlert({ event }: { event: EventDetail }) {
  const t = useT();
  const { data: session } = useSession();
  if (event.status !== "suspended") return null;
  return (
    <Alert variant="destructive">
      <Ban />
      <AlertTitle>{t("eventAdmin.layout.suspended.title")}</AlertTitle>
      <AlertDescription>
        {hasRole(session?.user, ["admin"])
          ? t("eventAdmin.layout.suspended.admin")
          : t("eventAdmin.layout.suspended.organizer")}
      </AlertDescription>
    </Alert>
  );
}

function LayoutSkeleton() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={t("eventAdmin.layout.loading")}>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-10 w-2/3 max-w-md" />
      <Skeleton className="h-9 w-full max-w-sm" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
          <Skeleton className="h-96" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-72" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </div>
  );
}
