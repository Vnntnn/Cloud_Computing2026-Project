import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import {
  ArrowLeft, CircleCheckBig, CircleDashed, Copy, Lock, Mail, MailCheck, MailX, MoreHorizontal, Pencil, Trash2,
} from "lucide-react";
import { useState } from "react";
import type { DataTableFeatures } from "@/components/data-table/data-table-features";
import { UserAvatar } from "@/components/user-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { eventClient } from "@/lib/api";
import { problemMessage } from "@/lib/auth-errors";
import { useT, type Translate } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { invitationsKey, type Invitation } from "@/lib/invitations";
import { EditInvitationDialog } from "./invitation-dialogs";

const columnHelper = createColumnHelper<DataTableFeatures, Invitation>();

/** `locked`: the event is suspended and the viewer isn't an admin, so nothing can change. */
export const invitationColumns = (t: Translate, eventId: string, locked: boolean) =>
  columnHelper.columns([
    columnHelper.display({
      id: "invitee",
      header: t("eventAdmin.invitations.columns.invitee"),
      cell: ({ row }) => <Invitee invitation={row.original} />,
    }),
    columnHelper.accessor("status", {
      header: t("eventAdmin.invitations.columns.status"),
      cell: ({ row }) => <InvitationStatus invitation={row.original} />,
    }),
    columnHelper.accessor("createdAt", {
      header: t("eventAdmin.invitations.columns.invitedAt"),
      cell: ({ row }) => <InvitedAt invitation={row.original} />,
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">{t("eventAdmin.invitations.columns.actions")}</span>,
      cell: ({ row }) => <InvitationActions eventId={eventId} invitation={row.original} locked={locked} />,
    }),
  ]);

/** The account registered with the email when there is one; otherwise just the email. */
function Invitee({ invitation }: { invitation: Invitation }) {
  const t = useT();
  const { user } = invitation;
  return (
    <div className="flex min-w-56 items-center gap-3">
      {user ? (
        <UserAvatar user={user} />
      ) : (
        <Avatar>
          <AvatarFallback>
            <Mail className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}
      <div className="flex min-w-0 flex-col">
        {user ? (
          <>
            <span className="truncate font-medium">{user.name}</span>
            <span className="truncate text-sm text-muted-foreground">{invitation.email}</span>
          </>
        ) : (
          <>
            <span className="truncate font-medium">{invitation.email}</span>
            <span className="text-sm text-muted-foreground">{t("eventAdmin.invitations.row.noAccount")}</span>
          </>
        )}
      </div>
    </div>
  );
}

function InvitationStatus({ invitation }: { invitation: Invitation }) {
  const t = useT();
  if (invitation.status === "unused") {
    return (
      <Badge variant="secondary">
        <CircleDashed data-icon="inline-start" />
        {t("eventAdmin.invitations.filters.unused")}
      </Badge>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge>
        <CircleCheckBig data-icon="inline-start" />
        {t("eventAdmin.invitations.filters.used")}
      </Badge>
      {invitation.usedAt && (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(invitation.usedAt)}</span>
      )}
    </div>
  );
}

/** When it was added, and whether the invitation email has gone out (it waits while the event isn't invite-only). */
function InvitedAt({ invitation }: { invitation: Invitation }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1 whitespace-nowrap">
      <span>{formatDateTime(invitation.createdAt)}</span>
      {invitation.notifiedAt ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" title={formatDateTime(invitation.notifiedAt)}>
          <MailCheck className="size-3.5" />
          {t("eventAdmin.invitations.row.sent")}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" title={t("eventAdmin.invitations.row.notSentHint")}>
          <MailX className="size-3.5" />
          {t("eventAdmin.invitations.row.notSent")}
        </span>
      )}
    </div>
  );
}

function InvitationActions({ eventId, invitation, locked }: { eventId: string; invitation: Invitation; locked: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const used = invitation.status === "used";
  const frozen = locked || used;

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await eventClient.api.events({ id: eventId }).invitations({ invitationId: invitation.id }).delete();
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.add({ type: "success", title: t("eventAdmin.invitations.row.cancelled", { email: invitation.email }) });
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: invitationsKey(eventId) });
    },
    onError: async (error) => {
      setConfirmOpen(false);
      toast.add({ type: "error", title: problemMessage(error) });
      // e.g. it was used meanwhile: show the current state
      await queryClient.invalidateQueries({ queryKey: invitationsKey(eventId) });
    },
  });

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(invitation.email);
      toast.add({ type: "success", title: t("eventAdmin.invitations.row.emailCopied") });
    } catch {
      toast.add({ type: "error", title: t("eventAdmin.invitations.row.copyFailed") });
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label={t("eventAdmin.invitations.row.manage", { email: invitation.email })}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {used && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2">
                <Lock className="size-4" />
                {t("eventAdmin.invitations.row.usedLocked")}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          )}
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={frozen} onClick={() => setEditOpen(true)}>
              <Pencil />
              {t("eventAdmin.invitations.row.editEmail")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={copyEmail}>
              <Copy />
              {t("eventAdmin.invitations.row.copyEmail")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" disabled={frozen} onClick={() => setConfirmOpen(true)}>
              <Trash2 />
              {t("eventAdmin.invitations.row.cancel")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditInvitationDialog eventId={eventId} invitation={invitation} open={editOpen} onOpenChange={setEditOpen} />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("eventAdmin.invitations.row.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("eventAdmin.invitations.row.cancelDescription", { email: invitation.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              <ArrowLeft data-icon="inline-start" />
              {t("eventAdmin.invitations.row.back")}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
              {t("eventAdmin.invitations.row.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
