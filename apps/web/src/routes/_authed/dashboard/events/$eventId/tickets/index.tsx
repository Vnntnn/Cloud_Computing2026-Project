import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ClipboardList, Info, MoreHorizontal, Pencil, PencilLine, ShoppingCart, Ticket, TicketPlus, Trash2,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { availabilityQueryOptions, type Availability } from "@/lib/enrollments";
import { useT } from "@/i18n";
import { formatNumber, formatPrice } from "@/lib/format";
import { useLiveSeats } from "@/lib/live-seats";
import { hasRole, useSession } from "@/lib/session";
import { kindInfo, ticketTypesQueryOptions, type TicketType } from "@/lib/ticket-types";
import { useEventDetail } from "../-components/use-event-detail";
import { DeleteTicketTypeDialog } from "./-components/delete-ticket-type-dialog";

export const Route = createFileRoute("/_authed/dashboard/events/$eventId/tickets/")({ component: TicketsTab });

function TicketsTab() {
  const t = useT();
  const event = useEventDetail();
  const { data: session } = useSession();
  // a suspended event is frozen for its organizer until an admin lifts it
  const locked = event.status === "suspended" && !hasRole(session?.user, ["admin"]);
  const { data: types, isPending } = useQuery(ticketTypesQueryOptions(event.id));
  const { data: availability } = useQuery(availabilityQueryOptions(event.id));
  useLiveSeats(event.id);
  const params = { eventId: event.id };

  const addButton = locked ? (
    <Button disabled>
      <TicketPlus data-icon="inline-start" />
      {t("eventAdmin.tickets.add")}
    </Button>
  ) : (
    <Link to="/dashboard/events/$eventId/tickets/new" params={params} className={buttonVariants()}>
      <TicketPlus data-icon="inline-start" />
      {t("eventAdmin.tickets.add")}
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      {event.status === "draft" && !!types?.length && (
        <Alert>
          <Info />
          <AlertTitle>{t("eventAdmin.tickets.draft.title")}</AlertTitle>
          <AlertDescription>{t("eventAdmin.tickets.draft.description")}</AlertDescription>
          <AlertAction>
            <Link to="/dashboard/events/$eventId" params={params} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <PencilLine data-icon="inline-start" />
              {t("eventAdmin.tickets.draft.goToDetails")}
            </Link>
          </AlertAction>
        </Alert>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Ticket className="size-5 text-primary dark:text-chart-2" />
            {t("eventAdmin.tickets.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("eventAdmin.tickets.description")}
          </p>
        </div>
        {addButton}
      </div>

      {isPending ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label={t("eventAdmin.ticketType.loading")}>
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : !types?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TicketPlus />
            </EmptyMedia>
            <EmptyTitle>{t("eventAdmin.tickets.empty.title")}</EmptyTitle>
            <EmptyDescription>
              {t("eventAdmin.tickets.empty.description")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addButton}</EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {types.map((type) => (
            <TicketTypeCard
              key={type.id}
              eventId={event.id}
              ticketType={type}
              availability={availability?.find((a) => a.ticketTypeId === type.id)}
              locked={locked}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketTypeCard({
  eventId,
  ticketType,
  availability,
  locked,
}: {
  eventId: string;
  ticketType: TicketType;
  availability: Availability | undefined;
  locked: boolean;
}) {
  const t = useT();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { icon: KindIcon, label } = kindInfo[ticketType.kind];
  const held = availability ? availability.confirmed + availability.reserved + availability.pending : 0;
  const params = { eventId, ticketTypeId: ticketType.id };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{ticketType.name}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <KindIcon data-icon="inline-start" />
            {label}
          </Badge>
          <span className="font-medium text-foreground">{formatPrice(ticketType.price)}</span>
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label={t("eventAdmin.tickets.card.manage", { name: ticketType.name })}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem render={<Link to="/dashboard/events/$eventId/tickets/$ticketTypeId" params={params} />}>
                  <Pencil />
                  {t("eventAdmin.tickets.card.edit")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" disabled={locked || held > 0} onClick={() => setDeleteOpen(true)}>
                  <Trash2 />
                  {t("eventAdmin.tickets.card.delete")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {ticketType.description && (
          <p className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">{ticketType.description}</p>
        )}
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{t("eventAdmin.tickets.card.confirmed")}</dt>
            <dd className="font-semibold tabular-nums">
              {formatNumber(availability?.confirmed ?? 0)}
              {ticketType.quota !== null && (
                <span className="font-normal text-muted-foreground"> / {formatNumber(ticketType.quota)}</span>
              )}
            </dd>
          </div>
          {ticketType.kind === "approval" ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{t("eventAdmin.tickets.card.pending")}</dt>
              <dd className="font-semibold tabular-nums">{formatNumber(availability?.pending ?? 0)}</dd>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{t("eventAdmin.tickets.card.awaitingPayment")}</dt>
              <dd className="font-semibold tabular-nums">{formatNumber(availability?.reserved ?? 0)}</dd>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{t("eventAdmin.tickets.card.remaining")}</dt>
            <dd className="font-semibold tabular-nums">
              {availability?.remaining == null ? t("eventAdmin.tickets.card.unlimited") : formatNumber(availability.remaining)}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <ShoppingCart className="size-4" />
            {t("eventAdmin.tickets.card.maxPerUser", { n: ticketType.maxPerUser })}
          </span>
          <span className="flex items-center gap-1">
            <ClipboardList className="size-4" />
            {ticketType.questions.length ? t("eventAdmin.tickets.card.questions", { n: ticketType.questions.length }) : t("eventAdmin.tickets.card.noQuestions")}
          </span>
        </div>
      </CardContent>
      <CardFooter>
        <Link
          to="/dashboard/events/$eventId/tickets/$ticketTypeId"
          params={params}
          className={buttonVariants({ variant: "outline", className: "w-full" })}
        >
          <Pencil data-icon="inline-start" />
          {t("eventAdmin.tickets.card.editForm")}
        </Link>
      </CardFooter>
      <DeleteTicketTypeDialog eventId={eventId} ticketType={ticketType} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </Card>
  );
}
