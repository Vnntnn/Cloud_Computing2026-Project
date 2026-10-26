import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { ArrowLeft, BadgeCheck, Check, ClipboardCheck, Eye, Mail, Ticket, Undo2, UserRound, UserX, X } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import type { DataTableFeatures } from "@/components/data-table/data-table-features";
import { EnrollmentStatusBadge } from "@/components/enrollment-status-badge";
import { SubmitButton, TextField } from "@/components/form-field";
import { RefundStatusBadge } from "@/components/refund-status-badge";
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
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { paymentClient, registrationClient } from "@/lib/api";
import { t as translate, useT, type Translate } from "@/i18n";
import { problemMessage } from "@/lib/auth-errors";
import { enrollmentsKey, type Enrollment } from "@/lib/enrollments";
import { formatBaht, formatDateTime, formatPrice } from "@/lib/format";
import { kindInfo } from "@/lib/ticket-types";

const columnHelper = createColumnHelper<DataTableFeatures, Enrollment>();

/** `locked`: the event is suspended and the viewer isn't an admin, so nothing can be reviewed. */
export const enrollmentColumns = (t: Translate, locked: boolean) =>
  columnHelper.columns([
    columnHelper.display({
      id: "buyer",
      header: t("eventAdmin.participants.columns.buyer"),
      cell: ({ row }) => <Buyer enrollment={row.original} />,
    }),
    columnHelper.display({
      id: "ticket",
      header: t("eventAdmin.participants.columns.ticket"),
      cell: ({ row }) => {
        const { ticketType, quantity } = row.original;
        const { icon: Icon } = kindInfo[ticketType.kind];
        return (
          <span className="flex min-w-40 items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{ticketType.name}</span>
            <span className="text-muted-foreground tabular-nums">× {quantity}</span>
          </span>
        );
      },
    }),
    columnHelper.accessor("status", {
      header: t("eventAdmin.participants.columns.status"),
      cell: ({ row }) => <EnrollmentStatusBadge enrollment={row.original} />,
    }),
    columnHelper.accessor("total", {
      header: t("eventAdmin.participants.columns.total"),
      cell: ({ row }) => <span className="tabular-nums">{formatPrice(row.original.total)}</span>,
    }),
    columnHelper.accessor("createdAt", {
      header: t("eventAdmin.participants.columns.createdAt"),
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</span>,
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">{t("eventAdmin.participants.columns.actions")}</span>,
      cell: ({ row }) => <EnrollmentDialog enrollment={row.original} locked={locked} />,
    }),
  ]);

function Buyer({ enrollment }: { enrollment: Enrollment }) {
  const t = useT();
  const { buyer } = enrollment;
  if (!buyer) {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <UserX className="size-4" />
        {t("eventAdmin.participants.accountDeleted")}
      </span>
    );
  }
  return (
    <div className="flex min-w-48 flex-col">
      <span className="truncate font-medium">{buyer.name}</span>
      <span className="truncate text-sm text-muted-foreground">{buyer.email}</span>
    </div>
  );
}

function useReviewed() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: enrollmentsKey });
}

/**
 * The whole enrollment: every attendee and their answers, plus approve / reject for a pending one
 * and a full refund for a confirmed paid one. Rejecting is a step inside this dialog; approving and
 * refunding open a nested confirm dialog, and DialogContent sinks back behind it (data-nested-dialog-open).
 */
function EnrollmentDialog({ enrollment, locked }: { enrollment: Enrollment; locked: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const reviewable = enrollment.status === "pending" && !locked;
  const refundable = enrollment.status === "confirmed" && enrollment.total > 0 && !locked;
  const close = () => setOpen(false);
  const buyerName = enrollment.buyer?.name ?? t("eventAdmin.participants.deletedUser");

  return (
    <div className="flex justify-end">
      <Dialog
        open={open}
        onOpenChange={setOpen}
        // reset only once the close animation ends, so the content doesn't jump while fading out
        onOpenChangeComplete={(next) => !next && setRejecting(false)}
      >
        <DialogTrigger render={<Button size="sm" variant={reviewable ? "default" : "outline"} />}>
          {reviewable ? <ClipboardCheck data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
          {reviewable ? t("eventAdmin.participants.dialog.review") : t("eventAdmin.participants.dialog.details")}
        </DialogTrigger>
        <DialogContent>
          {rejecting ? (
            <RejectForm enrollment={enrollment} buyerName={buyerName} onBack={() => setRejecting(false)} onDone={close} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("eventAdmin.participants.dialog.title", { name: buyerName })}</DialogTitle>
                <DialogDescription>
                  {enrollment.ticketType.name} × {enrollment.quantity} · {formatPrice(enrollment.total)} · {formatDateTime(enrollment.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="-mx-6 flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-6">
                <EnrollmentStatusBadge enrollment={enrollment} />
                {enrollment.refunds.map((refund) => (
                  <div key={refund.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Undo2 className="size-4 text-muted-foreground" />
                    {t("eventAdmin.participants.dialog.refund", { amount: formatBaht(refund.amount), percent: refund.percent })}
                    <RefundStatusBadge status={refund.status} />
                    <span className="text-xs text-muted-foreground">{formatDateTime(refund.createdAt)}</span>
                  </div>
                ))}
                <ol className="flex flex-col gap-3">
                  {enrollment.tickets.map((ticket, index) => (
                    <li key={ticket.id} className="flex flex-col gap-3 rounded-md border p-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 font-medium">
                          <UserRound className="size-4 text-muted-foreground" />
                          {ticket.firstName} {ticket.lastName}
                        </span>
                        <Badge variant="outline">
                          <Ticket data-icon="inline-start" />
                          {t("eventAdmin.participants.dialog.ticketNo", { n: index + 1 })}
                        </Badge>
                      </div>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Mail className="size-4" />
                        {ticket.email}
                      </span>
                      {ticket.code && <span className="font-mono tracking-widest">{ticket.code}</span>}
                      {ticket.answers.length > 0 && (
                        <dl className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2">
                          {ticket.answers.map((answer) => (
                            <div key={answer.questionId} className="flex flex-col">
                              <dt className="text-xs text-muted-foreground">{answer.label}</dt>
                              <dd className="break-words whitespace-pre-wrap">{answer.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
              {reviewable && (
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejecting(true)}>
                    <X data-icon="inline-start" />
                    {t("eventAdmin.participants.dialog.reject")}
                  </Button>
                  <ApproveButton enrollment={enrollment} buyerName={buyerName} onDone={close} />
                </DialogFooter>
              )}
              {refundable && (
                <DialogFooter>
                  <RefundButton enrollment={enrollment} buyerName={buyerName} onDone={close} />
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApproveButton({ enrollment, buyerName, onDone }: { enrollment: Enrollment; buyerName: string; onDone: () => void }) {
  const t = useT();
  const reviewed = useReviewed();
  const paid = enrollment.total > 0;
  const approve = useMutation({
    mutationFn: async () => {
      const { data, error } = await registrationClient.api.regis.enrollments({ id: enrollment.id }).approve.post();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.add({
        type: "success",
        title: t("eventAdmin.participants.approve.done", { name: buyerName }),
        description: paid ? t("eventAdmin.participants.approve.paymentMailed") : t("eventAdmin.participants.approve.ticketsMailed"),
      });
      onDone();
      return reviewed();
    },
    onError: (error) => {
      toast.add({ type: "error", title: problemMessage(error) });
      return reviewed();
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button />}>
        <Check data-icon="inline-start" />
        {t("eventAdmin.participants.approve.button")}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-primary/10 text-primary dark:text-chart-2">
            <BadgeCheck />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("eventAdmin.participants.approve.title", { name: buyerName })}</AlertDialogTitle>
          <AlertDialogDescription>
            {paid
              ? t("eventAdmin.participants.approve.paidDescription", { total: formatPrice(enrollment.total) })
              : t("eventAdmin.participants.approve.freeDescription", { n: enrollment.quantity })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={approve.isPending}>
            <ArrowLeft data-icon="inline-start" />
            {t("eventAdmin.participants.back")}
          </AlertDialogCancel>
          <AlertDialogAction disabled={approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
            {t("eventAdmin.participants.approve.button")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const noteSchema = z.object({ note: z.string().trim().max(500, { error: () => translate("eventAdmin.participants.noteTooLong") }) });

function RejectForm({
  enrollment,
  buyerName,
  onBack,
  onDone,
}: {
  enrollment: Enrollment;
  buyerName: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const reviewed = useReviewed();
  const form = useForm({
    defaultValues: { note: "" },
    validators: { onSubmit: noteSchema },
    onSubmit: async ({ value }) => {
      const { error } = await registrationClient.api.regis.enrollments({ id: enrollment.id }).reject.post({
        note: value.note.trim() || undefined,
      });
      if (error) {
        toast.add({ type: "error", title: problemMessage(error) });
        return void reviewed();
      }
      toast.add({ type: "success", title: t("eventAdmin.participants.reject.done", { name: buyerName }), description: t("eventAdmin.participants.reject.mailed") });
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
        void form.handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("eventAdmin.participants.reject.title", { name: buyerName })}</DialogTitle>
        <DialogDescription>{t("eventAdmin.participants.reject.description")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <form.Field name="note">
          {(field) => (
            <TextField
              field={field}
              label={t("eventAdmin.participants.reject.note")}
              multiline
              autoFocus
              placeholder={t("eventAdmin.participants.reject.notePlaceholder")}
            />
          )}
        </form.Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          {t("eventAdmin.participants.back")}
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <SubmitButton pending={isSubmitting} icon={X} variant="destructive">
              {t("eventAdmin.participants.dialog.reject")}
            </SubmitButton>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}

/** Cancels a confirmed paid order and refunds all of it, whatever its policy says (e.g. the event is called off). */
function RefundButton({ enrollment, buyerName, onDone }: { enrollment: Enrollment; buyerName: string; onDone: () => void }) {
  const t = useT();
  const reviewed = useReviewed();
  const [open, setOpen] = useState(false);
  const form = useForm({
    defaultValues: { note: "" },
    validators: { onSubmit: noteSchema },
    onSubmit: async ({ value }) => {
      const { data, error } = await paymentClient.api.payment.enrollments({ id: enrollment.id }).refund.post({
        note: value.note.trim() || undefined,
      });
      if (error) {
        toast.add({ type: "error", title: problemMessage(error) });
        return void reviewed();
      }
      toast.add({
        type: "success",
        title: t("eventAdmin.participants.refundFlow.done", { amount: formatBaht(data.amount), name: buyerName }),
        description: t("eventAdmin.participants.refundFlow.doneDescription"),
      });
      onDone();
      await reviewed();
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !form.state.isSubmitting && setOpen(next)}
      onOpenChangeComplete={(next) => !next && form.reset()}
    >
      <AlertDialogTrigger render={<Button variant="outline" />}>
        <Undo2 data-icon="inline-start" />
        {t("eventAdmin.participants.refundFlow.button")}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        {/* contents: the header, field and footer stay items of the dialog's grid */}
        <form
          noValidate
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Undo2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("eventAdmin.participants.refundFlow.title", { name: buyerName })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("eventAdmin.participants.refundFlow.description", { total: formatPrice(enrollment.total), n: enrollment.quantity })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <form.Field name="note">
              {(field) => (
                <TextField
                  field={field}
                  label={t("eventAdmin.participants.refundFlow.note")}
                  multiline
                  placeholder={t("eventAdmin.participants.refundFlow.notePlaceholder")}
                />
              )}
            </form.Field>
          </FieldGroup>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isSubmitting}>
                  <ArrowLeft data-icon="inline-start" />
                  {t("eventAdmin.participants.back")}
                </AlertDialogCancel>
                <SubmitButton pending={isSubmitting} icon={Undo2} variant="destructive">
                  {t("eventAdmin.participants.refundFlow.submit")}
                </SubmitButton>
              </AlertDialogFooter>
            )}
          </form.Subscribe>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
