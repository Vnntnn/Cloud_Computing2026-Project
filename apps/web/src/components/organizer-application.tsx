import { hasRole, useSession } from "@/lib/session";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, Ban, CalendarDays, CircleAlert, Clock, FileText, History, Inbox, RotateCcw, Send, Undo2, XCircle, type LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ApplicationDetails } from "@/components/application-details";
import { ApplicationStatusBadge } from "@/components/application-status-badge";
import { SubmitButton, TextField } from "@/components/form-field";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/api";
import { problemMessage } from "@/lib/auth-errors";
import { t as translate, useT } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import {
  myApplicationHistoryQueryOptions,
  myApplicationQueryOptions,
  type ApplicationStatus,
  type MyApplication,
} from "@/lib/organizer-applications";
import { cn } from "@/lib/utils";

// mirrors the limits in apps/auth/src/routes/organizer-applications/model.ts
const applicationSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, { error: () => translate("shared.organizerApplication.form.nameRequired") })
    .max(120, { error: () => translate("shared.organizerApplication.form.tooLong") }),
  contact: z
    .string()
    .trim()
    .min(3, { error: () => translate("shared.organizerApplication.form.contactRequired") })
    .max(200, { error: () => translate("shared.organizerApplication.form.tooLong") }),
  reason: z
    .string()
    .trim()
    .min(10, { error: () => translate("shared.organizerApplication.form.reasonMin") })
    .max(2000, { error: () => translate("shared.organizerApplication.form.tooLong") }),
});

const heroes: Record<ApplicationStatus, { icon: LucideIcon; tone: string }> = {
  pending: { icon: Clock, tone: "bg-secondary text-secondary-foreground" },
  approved: { icon: BadgeCheck, tone: "bg-primary text-primary-foreground" },
  rejected: { icon: XCircle, tone: "bg-destructive/10 text-destructive" },
  cancelled: { icon: Ban, tone: "bg-muted text-muted-foreground" },
};

type ApplicationInput = z.input<typeof applicationSchema>;

/** The decision, front and center: a large icon, the status, and one line of context. */
function StatusHero({
  status,
  children,
  action,
}: {
  status: ApplicationStatus;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const t = useT();
  const { icon: Icon, tone } = heroes[status];
  return (
    <div data-slot="application-status" className="flex flex-col items-center gap-4 py-10 text-center">
      <div className={cn("flex size-24 items-center justify-center rounded-full", tone)}>
        <Icon className="size-12" />
      </div>
      <h2 className="text-3xl font-bold">{t(`shared.applicationStatus.${status}`)}</h2>
      <p className="max-w-md text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

/** Lets a plain user apply to become an organizer and shows the latest decision. */
export function OrganizerApplication() {
  const t = useT();
  const { data: application, isPending } = useQuery(myApplicationQueryOptions);
  const [retrying, setRetrying] = useState(false);
  const { data: session } = useSession();
  // an organizer made without an application (promoted by an admin or a script) has nothing to apply for: the service refuses it
  const alreadyOrganizer = hasRole(session?.user, ["organizer", "admin"]);

  if (isPending) return <Skeleton className="h-64" />;

  if (application?.status === "pending") {
    return (
      <StatusHero
        status="pending"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <ViewApplication application={application} />
            <CancelApplication />
          </div>
        }
      >
        {t("shared.organizerApplication.pendingBefore")}{" "}
        <strong className="text-foreground">{application.organizationName}</strong>{" "}
        {t("shared.organizerApplication.pendingAfter", { date: formatDateTime(application.createdAt) })}
      </StatusHero>
    );
  }

  // (a pending application was answered above)
  if (application?.status === "approved" || alreadyOrganizer) {
    return (
      <StatusHero
        status="approved"
        action={
          <Link to="/dashboard/events" className={buttonVariants({ size: "lg" })}>
            <CalendarDays data-icon="inline-start" />
            {t("shared.organizerApplication.manageEvents")}
          </Link>
        }
      >
        {t("shared.organizerApplication.approvedBody")}
      </StatusHero>
    );
  }

  if (application?.status === "rejected") {
    return retrying ? (
      // starts from the rejected answers so the user only fixes what the reviewer pointed out
      <ApplicationForm
        defaultValues={{
          organizationName: application.organizationName,
          contact: application.contact,
          reason: application.reason,
        }}
        onBack={() => setRetrying(false)}
      />
    ) : (
      <StatusHero
        status="rejected"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="lg" onClick={() => setRetrying(true)}>
              <RotateCcw data-icon="inline-start" />
              {t("shared.organizerApplication.retry")}
            </Button>
            <ApplicationHistory />
          </div>
        }
      >
        {application.reviewNote
          ? t("shared.organizerApplication.note", { note: application.reviewNote })
          : t("shared.organizerApplication.retryHint")}
      </StatusHero>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {application?.status === "cancelled" && (
        <Alert>
          <Ban />
          <AlertDescription>{t("shared.organizerApplication.cancelledAlert")}</AlertDescription>
          <AlertAction>
            <ApplicationHistory size="sm" />
          </AlertAction>
        </Alert>
      )}
      <ApplicationForm />
    </div>
  );
}

/** Read-only copy of what the user submitted. */
function ViewApplication({ application }: { application: MyApplication }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <FileText data-icon="inline-start" />
        {t("shared.organizerApplication.view.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("shared.organizerApplication.view.title")}</DialogTitle>
            <DialogDescription>{t("shared.organizerApplication.view.description")}</DialogDescription>
          </DialogHeader>
          <ApplicationDetails application={application} className="max-h-[60vh] overflow-y-auto" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Every application the user has sent, newest first, with each outcome. */
function ApplicationHistory({ size = "lg" }: { size?: "sm" | "lg" }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { data: history, isPending } = useQuery({ ...myApplicationHistoryQueryOptions, enabled: open });

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <History data-icon="inline-start" />
        {t("shared.organizerApplication.history.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("shared.organizerApplication.history.title")}</DialogTitle>
            <DialogDescription>{t("shared.organizerApplication.history.description")}</DialogDescription>
          </DialogHeader>
          <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6">
            {isPending ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
              </div>
            ) : !history?.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Inbox />
                  </EmptyMedia>
                  <EmptyTitle>{t("shared.organizerApplication.history.empty")}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <ol className="flex flex-col gap-3">
                {history.map((item) => (
                  <li key={item.id} className="flex flex-col gap-3 rounded-md border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <ApplicationStatusBadge status={item.status} />
                      {item.reviewedAt && (
                        <span className="text-xs text-muted-foreground">
                          {t("shared.organizerApplication.history.reviewedAt", { date: formatDateTime(item.reviewedAt) })}
                        </span>
                      )}
                    </div>
                    <ApplicationDetails application={item} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CancelApplication() {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.api.auth["organizer-applications"].me.delete();
      if (error) throw error;
    },
    onSuccess: async () => {
      setOpen(false);
      toast.add({ type: "success", title: t("shared.organizerApplication.cancel.toast") });
      await queryClient.invalidateQueries({ queryKey: myApplicationQueryOptions.queryKey });
    },
    onError: (error) => toast.add({ type: "error", title: problemMessage(error) }),
  });

  return (
    <>
      <Button variant="destructive" size="lg" onClick={() => setOpen(true)}>
        <Undo2 data-icon="inline-start" />
        {t("shared.organizerApplication.cancel.button")}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Undo2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("shared.organizerApplication.cancel.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("shared.organizerApplication.cancel.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("shared.organizerApplication.cancel.keep")}</AlertDialogCancel>
            <Button variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {cancel.isPending ? <Spinner data-icon="inline-start" /> : <Undo2 data-icon="inline-start" />}
              {t("shared.organizerApplication.cancel.button")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ApplicationForm({
  defaultValues = { organizationName: "", contact: "", reason: "" },
  onBack,
}: {
  defaultValues?: ApplicationInput;
  onBack?: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues,
    validators: { onSubmit: applicationSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const { error } = await authClient.api.auth["organizer-applications"].post({
        organizationName: value.organizationName.trim(),
        contact: value.contact.trim(),
        reason: value.reason.trim(),
      });
      if (error) return setFormError(problemMessage(error));
      toast.add({
        type: "success",
        title: t("shared.organizerApplication.form.sentTitle"),
        description: t("shared.organizerApplication.form.sentDescription"),
      });
      await queryClient.invalidateQueries({ queryKey: myApplicationQueryOptions.queryKey });
    },
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        {formError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <form.Field name="organizationName">
          {(field) => <TextField field={field} label={t("shared.applicationDetails.organizationName")} autoComplete="organization" />}
        </form.Field>
        <form.Field name="contact">
          {(field) => (
            <TextField
              field={field}
              label={t("shared.applicationDetails.contact")}
              placeholder={t("shared.organizerApplication.form.contactPlaceholder")}
            />
          )}
        </form.Field>
        <form.Field name="reason">
          {(field) => (
            <TextField
              field={field}
              label={t("shared.organizerApplication.form.reasonLabel")}
              multiline
              placeholder={t("shared.organizerApplication.form.reasonPlaceholder")}
            />
          )}
        </form.Field>
        <div className="flex flex-wrap gap-2">
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack}>
              <ArrowLeft data-icon="inline-start" />
              {t("shared.organizerApplication.form.back")}
            </Button>
          )}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <SubmitButton pending={isSubmitting} icon={Send}>
                {t("shared.organizerApplication.form.submit")}
              </SubmitButton>
            )}
          </form.Subscribe>
        </div>
      </FieldGroup>
    </form>
  );
}
