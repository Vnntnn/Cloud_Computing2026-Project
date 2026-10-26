import { createFileRoute } from "@tanstack/react-router";
import { useEventDetail } from "../-components/use-event-detail";
import { TicketTypeEditor } from "./-components/ticket-type-editor";

export const Route = createFileRoute("/_authed/dashboard/events/$eventId/tickets/new")({
  staticData: { title: "common.pageTitle.newTicketType" }, component: NewTicketTypePage });

function NewTicketTypePage() {
  const event = useEventDetail();
  return <TicketTypeEditor event={event} />;
}
