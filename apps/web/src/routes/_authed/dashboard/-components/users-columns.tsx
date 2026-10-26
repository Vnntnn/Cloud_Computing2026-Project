import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { ArrowLeft, Ban, MoreHorizontal, ShieldCheck, UserRoundCog } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { roleNames, type Role } from "@app/auth-guard/permissions";
import type { DataTableFeatures } from "@/components/data-table/data-table-features";
import { SubmitButton, TextField } from "@/components/form-field";
import { RoleBadge } from "@/components/role-badge";
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
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { t, useT, type Translate } from "@/i18n";
import { adminUsersKey, type AdminUser } from "@/lib/admin-users";
import { auth } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { formatDate } from "@/lib/format";
import { roleLabels } from "@/lib/roles";

const columnHelper = createColumnHelper<DataTableFeatures, AdminUser>();

/** `currentUserId` hides the actions on the admin's own row, so they can't ban or demote themselves. */
const userColumns = (t: Translate, currentUserId: string | undefined) =>
  columnHelper.columns([
    columnHelper.display({
      id: "user",
      header: t("dashboard.users.columns.user"),
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <UserAvatar user={row.original} />
          <div className="flex min-w-0 flex-col">
            <span className="font-medium break-words whitespace-normal">{row.original.name}</span>
            <span className="text-sm break-all whitespace-normal text-muted-foreground">{row.original.email}</span>
          </div>
        </div>
      ),
    }),
    columnHelper.accessor("role", {
      header: t("dashboard.users.columns.role"),
      cell: ({ getValue }) => <RoleBadge role={getValue()} />,
    }),
    columnHelper.accessor("banned", {
      header: t("dashboard.users.columns.status"),
      cell: ({ row }) =>
        row.original.banned ? (
          <Badge variant="destructive" title={row.original.banReason ?? undefined}>
            <Ban data-icon="inline-start" />
            {t("dashboard.users.banned")}
          </Badge>
        ) : (
          <Badge variant="secondary">
            <ShieldCheck data-icon="inline-start" />
            {t("dashboard.users.active")}
          </Badge>
        ),
    }),
    columnHelper.accessor("createdAt", {
      header: t("dashboard.users.columns.joined"),
      cell: ({ getValue }) => formatDate(getValue()),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">{t("dashboard.users.columns.manage")}</span>,
      cell: ({ row }) =>
        row.original.id === currentUserId ? (
          <span className="text-sm text-muted-foreground">{t("dashboard.users.you")}</span>
        ) : (
          <UserRowActions user={row.original} />
        ),
    }),
  ]);

export const useUserColumns = (currentUserId: string | undefined) => {
  const t = useT();
  return useMemo(() => userColumns(t, currentUserId), [t, currentUserId]);
};

function UserRowActions({ user }: { user: AdminUser }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [banOpen, setBanOpen] = useState(false);
  // a role change takes effect at once and moves what the account may do, so it asks first
  const [nextRole, setNextRole] = useState<Role | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminUsersKey });

  const setRole = useMutation({
    mutationFn: async (role: Role) => {
      const { error } = await auth.admin.setRole({ userId: user.id, role });
      if (error) throw error;
      return role;
    },
    onSuccess: (role) => {
      toast.add({ type: "success", title: t("dashboard.users.roleChanged", { name: user.name, role: roleLabels[role] }) });
      return refresh();
    },
    onError: (error) => toast.add({ type: "error", title: authErrorMessage(error) }),
  });

  const unban = useMutation({
    mutationFn: async () => {
      const { error } = await auth.admin.unbanUser({ userId: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.add({ type: "success", title: t("dashboard.users.unbanned", { name: user.name }) });
      return refresh();
    },
    onError: (error) => toast.add({ type: "error", title: authErrorMessage(error) }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label={t("dashboard.users.manageLabel", { name: user.name })}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-2">
              <UserRoundCog className="size-4" />
              {t("dashboard.users.changeRole")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={user.role ?? "user"}
              onValueChange={(role: Role) => role !== user.role && setNextRole(role)}
            >
              {roleNames.map((role) => (
                <DropdownMenuRadioItem key={role} value={role} disabled={setRole.isPending}>
                  {roleLabels[role]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {user.banned ? (
              <DropdownMenuItem disabled={unban.isPending} onClick={() => unban.mutate()}>
                <ShieldCheck />
                {t("dashboard.users.unban")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onClick={() => setBanOpen(true)}>
                <Ban />
                {t("dashboard.users.ban")}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={nextRole !== null} onOpenChange={(open) => !open && !setRole.isPending && setNextRole(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <UserRoundCog />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("dashboard.users.roleDialog.title", { name: user.name, role: nextRole ? roleLabels[nextRole] : "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("dashboard.users.roleDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setRole.isPending}>
              <ArrowLeft data-icon="inline-start" />
              {t("dashboard.users.roleDialog.back")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={setRole.isPending}
              onClick={() => nextRole && setRole.mutate(nextRole, { onSettled: () => setNextRole(null) })}
            >
              {setRole.isPending ? <Spinner data-icon="inline-start" /> : <UserRoundCog data-icon="inline-start" />}
              {t("dashboard.users.roleDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <BanUserDialog user={user} open={banOpen} onOpenChange={setBanOpen} onBanned={refresh} />
    </>
  );
}

const banSchema = z.object({
  reason: z.string().trim().max(300, { error: () => t("dashboard.users.banDialog.tooLong") }),
});

function BanUserDialog({
  user,
  open,
  onOpenChange,
  onBanned,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBanned: () => Promise<unknown>;
}) {
  const t = useT();
  const form = useForm({
    defaultValues: { reason: "" },
    validators: { onSubmit: banSchema },
    onSubmit: async ({ value }) => {
      const { error } = await auth.admin.banUser({
        userId: user.id,
        banReason: value.reason.trim() || undefined,
      });
      if (error) return void toast.add({ type: "error", title: authErrorMessage(error) });
      toast.add({
        type: "success",
        title: t("dashboard.users.banDialog.toastTitle", { name: user.name }),
        description: t("dashboard.users.banDialog.toastDescription"),
      });
      form.reset();
      onOpenChange(false);
      await onBanned();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="size-5 text-destructive" />
              {t("dashboard.users.banDialog.title", { name: user.name })}
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.users.banDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <form.Field name="reason">
              {(field) => (
                <TextField
                  field={field}
                  label={t("dashboard.users.banDialog.reasonLabel")}
                  multiline
                  placeholder={t("dashboard.users.banDialog.reasonPlaceholder")}
                />
              )}
            </form.Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{t("dashboard.users.banDialog.cancel")}</DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <SubmitButton pending={isSubmitting} icon={Ban} variant="destructive">
                  {t("dashboard.users.banDialog.submit")}
                </SubmitButton>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
