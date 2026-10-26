import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, TicketX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { availabilityQueryOptions } from "@/lib/enrollments";
import { useLiveSeats } from "@/lib/live-seats";
import { useT } from "@/i18n";
import { ticketTypesQueryOptions } from "@/lib/ticket-types";
import { useEventDetail } from "../-components/use-event-detail";
import { TicketTypeEditor } from "./-components/ticket-type-editor";

export const Route = createFileRoute("/_authed/dashboard/events/$eventId/tickets/$ticketTypeId")({
  staticData: { title: "common.pageTitle.editTicketType" },
  component: EditTicketTypePage,
});

function EditTicketTypePage() {
  const t = useT();
  const event = useEventDetail();
  const { ticketTypeId } = Route.useParams();
  const { data: types, isPending } = useQuery(ticketTypesQueryOptions(event.id));
  const { data: availability, isPending: availabilityPending } = useQuery(availabilityQueryOptions(event.id));
  useLiveSeats(event.id);

  // waits for the seats too: they decide whether the kind is locked
  if (isPending || availabilityPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label={t("eventAdmin.ticketType.loading")}>
        <Skeleton className="h-8 w-40" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex flex-col gap-6">
            <Skeleton className="h-80" />
            <Skeleton className="h-96" />
          </div>
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  const ticketType = types?.find((type) => type.id === ticketTypeId);
  if (!ticketType) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TicketX />
          </EmptyMedia>
          <EmptyTitle>{t("eventAdmin.ticketType.notFound.title")}</EmptyTitle>
          <EmptyDescription>{t("eventAdmin.ticketType.notFound.description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link
            to="/dashboard/events/$eventId/tickets"
            params={{ eventId: event.id }}
            className={buttonVariants({ variant: "outline" })}
          >
            <ArrowLeft data-icon="inline-start" />
            {t("eventAdmin.ticketType.notFound.back")}
          </Link>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <TicketTypeEditor
      key={ticketType.id}
      event={event}
      ticketType={ticketType}
      availability={availability?.find((a) => a.ticketTypeId === ticketType.id)}
    />
  );
}
