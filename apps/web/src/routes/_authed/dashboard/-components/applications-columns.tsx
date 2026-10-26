import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { ArrowLeft, BadgeCheck, Ban, Check, ClipboardCheck, Clock, Eye, History, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ApplicationDetails } from "@/components/application-details";
import type { DataTableFeatures } from "@/components/data-table/data-table-features";
import { SubmitButton, TextField } from "@/components/form-field";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { t, useT } from "@/i18n";
import { adminUsersKey } from "@/lib/admin-users";
import { authClient } from "@/lib/api";
import { problemMessage } from "@/lib/auth-errors";
import { formatDateTime } from "@/lib/format";
import {
  applicantHistoryQueryOptions,
  type ApplicationRow,
  type ApplicationStatus,
} from "@/lib/organizer-applications";

const columnHelper = createColumnHelper<DataTableFeatures, ApplicationRow>();

export const statusBadges: Record<
  ApplicationStatus,
  { label: string; icon: typeof Clock; variant: "outline" | "secondary" | "destructive" | "ghost" }
> = {
  // labels are getters so they follow the language; components reading them call useT()
  pending: { get label() { return t("dashboard.applications.status.pending"); }, icon: Clock, variant: "outline" },
  approved: { get label() { return t("dashboard.applications.status.approved"); }, icon: BadgeCheck, variant: "secondary" },
  rejected: { get label() { return t("dashboard.applications.status.rejected"); }, icon: XCircle, variant: "destructive" },
  cancelled: { get label() { return t("dashboard.applications.status.cancelled"); }, icon: Ban, variant: "ghost" },
};

function StatusBadge({ status }: { status: ApplicationStatus }) {
  useT();
  const { label, icon: Icon, variant } = statusBadges[status];
  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" />
      {label}
    </Badge>
  );
}

export function useApplicationColumns() {
  const t = useT();
  return useMemo(
    () =>
      columnHelper.columns([
      columnHelper.display({
        id: "applicant",
        header: t("dashboard.applications.columns.applicant"),
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <UserAvatar user={row.original.applicant} />
            <div className="flex min-w-0 flex-col">
              <span className="font-medium break-words whitespace-normal">{row.original.applicant.name}</span>
              <span className="text-sm break-all whitespace-normal text-muted-foreground">{row.original.applicant.email}</span>
            </div>
          </div>
        ),
      }),
      columnHelper.accessor("organizationName", {
        header: t("dashboard.applications.columns.organization"),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.organizationName}</span>
            <span className="text-sm text-muted-foreground">{row.original.contact}</span>
          </div>
        ),
      }),
      columnHelper.accessor("reason", {
        header: t("dashboard.applications.columns.details"),
        cell: ({ row }) => (
          <p className="max-w-[11rem] truncate" title={row.original.reason}>
            {row.original.reason}
          </p>
        ),
      }),
      columnHelper.accessor("createdAt", {
        header: t("dashboard.applications.columns.sentAt"),
        cell: ({ getValue }) => formatDateTime(getValue()),
      }),
      columnHelper.accessor("status", {
        header: t("dashboard.applications.columns.status"),
        cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      }),
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only">{t("dashboard.applications.columns.review")}</span>,
        cell: ({ row }) => <ApplicationDialog application={row.original} />,
      }),
      ]),
    [t],
  );
}

function useReviewed() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["organizer-applications"] }),
      // approving changes a role, so user counts and the users table move too
      queryClient.invalidateQueries({ queryKey: adminUsersKey }),
    ]);
}

const rejectSchema = z.object({
  note: z.string().trim().max(1000, { error: () => t("dashboard.applications.rejectForm.tooLong") }),
});

/**
 * Full application plus the review actions; long reasons stay out of the table rows.
 * Rejecting is a step inside this dialog; approving opens a nested confirm dialog,
 * and DialogContent sinks back behind it (data-nested-dialog-open).
 */
function ApplicationDialog({ application }: { application: ApplicationRow }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const pending = application.status === "pending";
  const close = () => setOpen(false);

  return (
    <div className="flex justify-end">
      <Dialog
        open={open}
        onOpenChange={setOpen}
        // reset only once the close animation ends, so the content doesn't jump while fading out
        onOpenChangeComplete={(next) => !next && setRejecting(false)}
      >
        <DialogTrigger render={<Button size="sm" variant={pending ? "default" : "outline"} />}>
          {pending ? <ClipboardCheck data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
          {pending ? t("dashboard.applications.dialog.review") : t("dashboard.applications.dialog.view")}
        </DialogTrigger>
        <DialogContent>
          {rejecting ? (
            <RejectForm application={application} onBack={() => setRejecting(false)} onDone={close} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("dashboard.applications.dialog.title", { name: application.applicant.name })}</DialogTitle>
                <DialogDescription>{application.applicant.email}</DialogDescription>
              </DialogHeader>
              <div className="-mx-6 flex max-h-[60vh] flex-col gap-6 overflow-y-auto px-6">
                <ApplicationDetails application={application} />
                <Separator />
                <ApplicantHistory application={application} />
              </div>
              {pending && (
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejecting(true)}>
                    <X data-icon="inline-start" />
                    {t("dashboard.applications.dialog.reject")}
                  </Button>
                  <ApproveButton application={application} onDone={close} />
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The applicant's other applications, so a reviewer sees earlier rejections and withdrawals. */
function ApplicantHistory({ application }: { application: ApplicationRow }) {
  const t = useT();
  const { data, isPending } = useQuery(applicantHistoryQueryOptions(application.applicant.id));
  const others = data?.filter((item) => item.id !== application.id);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-medium">
        <History className="size-4" />
        {t("dashboard.applications.history.title")}
      </h3>
      {isPending ? (
        <Skeleton className="h-16" />
      ) : !others?.length ? (
        <p className="text-muted-foreground">{t("dashboard.applications.history.none")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {others.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{item.organizationName}</span>
                <StatusBadge status={item.status} />
              </div>
              <span className="text-xs text-muted-foreground">{t("dashboard.applications.history.sentAt", { date: formatDateTime(item.createdAt) })}</span>
              {item.reviewNote && (
                <p className="break-words whitespace-pre-wrap text-muted-foreground">{t("dashboard.applications.history.note", { note: item.reviewNote })}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ApproveButton({ application, onDone }: { application: ApplicationRow; onDone: () => void }) {
  const t = useT();
  const reviewed = useReviewed();
  const approve = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.api.auth["organizer-applications"]({ id: application.id }).approve.post();
      if (error) throw error;
    },
    onSuccess: () => {
      toast.add({
        type: "success",
        title: t("dashboard.applications.approve.toastTitle", { name: application.applicant.name }),
        description: t("dashboard.applications.approve.toastDescription"),
      });
      onDone();
      return reviewed();
    },
    onError: (error) => toast.add({ type: "error", title: problemMessage(error) }),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button />}>
        <Check data-icon="inline-start" />
        {t("dashboard.applications.dialog.approve")}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-primary/10 text-primary dark:text-chart-2">
            <BadgeCheck />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("dashboard.applications.approve.title", { name: application.applicant.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("dashboard.applications.approve.description", { organization: application.organizationName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={approve.isPending}>
            <ArrowLeft data-icon="inline-start" />
            {t("dashboard.applications.approve.back")}
          </AlertDialogCancel>
          <AlertDialogAction disabled={approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
            {t("dashboard.applications.approve.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RejectForm({
  application,
  onBack,
  onDone,
}: {
  application: ApplicationRow;
  onBack: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const reviewed = useReviewed();

  const form = useForm({
    defaultValues: { note: "" },
    validators: { onSubmit: rejectSchema },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.api.auth["organizer-applications"]({ id: application.id }).reject.post({
        note: value.note.trim() || undefined,
      });
      if (error) return void toast.add({ type: "error", title: problemMessage(error) });
      toast.add({ type: "success", title: t("dashboard.applications.rejectForm.toast", { name: application.applicant.name }) });
      onDone();
      await reviewed();
    },
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("dashboard.applications.rejectForm.title", { name: application.applicant.name })}</DialogTitle>
        <DialogDescription>{t("dashboard.applications.rejectForm.description")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <form.Field name="note">
          {(field) => (
            <TextField
              field={field}
              label={t("dashboard.applications.rejectForm.noteLabel")}
              multiline
              autoFocus
              placeholder={t("dashboard.applications.rejectForm.notePlaceholder")}
            />
          )}
        </form.Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          {t("dashboard.applications.rejectForm.back")}
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <SubmitButton pending={isSubmitting} icon={X} variant="destructive">
              {t("dashboard.applications.rejectForm.submit")}
            </SubmitButton>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}
