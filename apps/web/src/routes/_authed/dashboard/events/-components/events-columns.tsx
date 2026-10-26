import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { Copy, ExternalLink, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { EventThumb } from "@/components/event-parts";
import { useMemo, useState } from "react";
import type { DataTableFeatures } from "@/components/data-table/data-table-features";
import { EventStatusBadge } from "@/components/event-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { useT, type Translate } from "@/i18n";
import { eventUrl, hasEnded, isLive, type EventSummary } from "@/lib/events";
import { formatLongDate, formatTime } from "@/lib/format";
import { DeleteEventDialog } from "./delete-event-dialog";

const columnHelper = createColumnHelper<DataTableFeatures, EventSummary>();

/** `canModerate`: admins may still delete suspended events; organizers can't touch them. */
const eventColumns = (t: Translate, canModerate: boolean) =>
  columnHelper.columns([
    columnHelper.display({
      id: "event",
      header: t("dashboard.events.columns.event"),
      cell: ({ row }) => {
        const event = row.original;
        return (
          <div className="flex min-w-56 items-center gap-3 @max-4xl/dt:min-w-0">
            <EventThumb event={event} className="aspect-video w-20" />
            <div className="flex min-w-0 flex-col">
              <Link
                to="/dashboard/events/$eventId"
                params={{ eventId: event.id }}
                className="line-clamp-2 font-medium whitespace-normal hover:underline"
              >
                {event.title}
              </Link>
              <span className="truncate text-sm text-muted-foreground">{event.category.name}</span>
            </div>
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "schedule",
      header: t("dashboard.events.columns.schedule"),
      cell: ({ row }) => {
        const event = row.original;
        return (
          <div className="flex flex-col gap-1 whitespace-nowrap">
            <span>{formatLongDate(event.startsAt)}</span>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("dashboard.events.time", { from: formatTime(event.startsAt), to: formatTime(event.endsAt) })}
              {isLive(event) ? (
                <Badge variant="default">{t("dashboard.events.live")}</Badge>
              ) : hasEnded(event) ? (
                <Badge variant="secondary">{t("dashboard.events.ended")}</Badge>
              ) : null}
            </span>
          </div>
        );
      },
    }),
    columnHelper.accessor("status", {
      header: t("dashboard.events.columns.status"),
      cell: ({ row }) => <EventStatusBadge status={row.original.status} publishAt={row.original.publishAt} />,
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">{t("dashboard.events.columns.manage")}</span>,
      cell: ({ row }) => <EventRowActions event={row.original} canModerate={canModerate} />,
    }),
  ]);

export const useEventColumns = (canModerate: boolean) => {
  const t = useT();
  return useMemo(() => eventColumns(t, canModerate), [t, canModerate]);
};

function EventRowActions({ event, canModerate }: { event: EventSummary; canModerate: boolean }) {
  const t = useT();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const frozen = event.status === "suspended" && !canModerate;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(eventUrl(event.slug));
      toast.add({ type: "success", title: t("dashboard.events.actions.copied") });
    } catch {
      toast.add({ type: "error", title: t("dashboard.events.actions.copyFailed") });
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label={t("dashboard.events.actions.manageLabel", { title: event.title })}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link to="/dashboard/events/$eventId" params={{ eventId: event.id }} />}>
              <Pencil />
              {frozen ? t("dashboard.events.actions.view") : t("dashboard.events.actions.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link to="/events/$slug" params={{ slug: event.slug }} target="_blank" />}>
              <ExternalLink />
              {t("dashboard.events.actions.viewPage")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyLink}>
              <Copy />
              {t("dashboard.events.actions.copyLink")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" disabled={frozen} onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              {t("dashboard.events.actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteEventDialog event={event} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}
