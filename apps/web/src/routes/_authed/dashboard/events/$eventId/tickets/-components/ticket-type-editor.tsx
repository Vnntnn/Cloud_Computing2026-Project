import { useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ClipboardList, Info, Lock, Ticket, TicketPlus, Trash2, Users } from "lucide-react";
import { useRef, useState } from "react";
import { TextField, SubmitButton } from "@/components/form-field";
import { LeaveGuard } from "@/components/leave-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/toast";
import { eventClient } from "@/lib/api";
import { useT } from "@/i18n";
import { problemMessage } from "@/lib/auth-errors";
import { enrollmentsKey, type Availability } from "@/lib/enrollments";
import { eventDetailKey, problemCode, type EventDetail } from "@/lib/events";
import { formatNumber, formatPrice } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
import { kindInfo, MIN_PAID_PRICE, ticketTypeProblemFields, type TicketKind, type TicketType } from "@/lib/ticket-types";
import { focusFirstInvalid } from "../../../-components/event-form";
import { SaveBar } from "../../../-components/save-bar";
import { DeleteTicketTypeDialog } from "./delete-ticket-type-dialog";
import { QuestionBuilder } from "./question-builder";
import {
  diffPayload, toFormValues, toPayload, useTicketTypeForm, type TicketTypeFormValues,
} from "./ticket-type-form";

const ROOT = "[data-slot=ticket-type-editor]";

type TicketTypeEditorProps = {
  event: EventDetail;
  /** omitted when creating one */
  ticketType?: TicketType;
  availability?: Availability;
};

/** Creates a ticket type, or edits one (saving through the floating save bar, like the event editor). */
export function TicketTypeEditor({ event, ticketType, availability }: TicketTypeEditorProps) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  // a suspended event is frozen for its organizer until an admin lifts it
  const locked = event.status === "suspended" && !hasRole(session?.user, ["admin"]);
  const [baseline, setBaseline] = useState(() => toFormValues(ticketType));
  const allowLeave = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const held = availability ? availability.confirmed + availability.reserved + availability.pending : 0;
  // seats someone holds while filling in the enroll form count toward the quota too
  const taken = held + (availability?.held ?? 0);
  // the service refuses to change the kind once anyone holds tickets of it
  const kindLocked = !!ticketType && taken > 0;
  const listParams = { eventId: event.id };

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ticket-types"] }),
      queryClient.invalidateQueries({ queryKey: enrollmentsKey }),
    ]);

  const form = useTicketTypeForm({
    defaultValues: baseline,
    onSubmitInvalid: () => {
      toast.add({ type: "error", title: t("eventAdmin.editor.invalid") });
      focusFirstInvalid(ROOT);
    },
    onSubmit: async ({ value }) => {
      const tickets = eventClient.api.events({ id: event.id })["ticket-types"];
      if (!ticketType) {
        const { data, error } = await tickets.post(toPayload(value));
        if (error) return showProblem(error);
        toast.add({ type: "success", title: t("eventAdmin.typeEditor.created", { name: data.name }) });
        allowLeave.current = true;
        await refresh();
        await navigate({ to: "/dashboard/events/$eventId/tickets", params: listParams });
        return;
      }
      const patch = diffPayload(value, baseline);
      if (Object.keys(patch).length === 0) return;
      const { data, error } = await tickets({ ticketTypeId: ticketType.id }).patch(patch);
      if (error) return showProblem(error);
      const next = toFormValues(data);
      setBaseline(next);
      form.reset(next);
      toast.add({ type: "success", title: t("eventAdmin.editor.saved") });
      void refresh();
    },
  });

  function showProblem(error: unknown) {
    const code = problemCode(error);
    const message = problemMessage(error);
    const field = code ? (ticketTypeProblemFields[code] as keyof TicketTypeFormValues | undefined) : undefined;
    if (field) {
      form.setFieldMeta(field, (meta) => ({ ...meta, isTouched: true, errorMap: { ...meta.errorMap, onServer: { message } } }));
      focusFirstInvalid(ROOT);
    }
    // e.g. an admin suspended the event meanwhile: reload so the page shows why
    if (code === "EVENT_SUSPENDED") void queryClient.invalidateQueries({ queryKey: eventDetailKey(event.id) });
    if (code === "KIND_LOCKED" || code === "QUOTA_BELOW_TAKEN") void queryClient.invalidateQueries({ queryKey: enrollmentsKey });
    toast.add({ type: "error", title: message });
  }

  const values = useStore(form.store, (state) => state.values);
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const changes = Object.keys(diffPayload(values, baseline)).length;

  return (
    <div data-slot="ticket-type-editor" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          to="/dashboard/events/$eventId/tickets"
          params={listParams}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}
        >
          <ArrowLeft data-icon="inline-start" />
          {t("eventAdmin.ticketType.notFound.back")}
        </Link>
        <h2 className="flex min-w-0 items-center gap-2 text-xl font-bold">
          {ticketType ? <Ticket className="size-5 shrink-0 text-primary dark:text-chart-2" /> : <TicketPlus className="size-5 shrink-0 text-primary dark:text-chart-2" />}
          <span className="truncate">{ticketType ? ticketType.name : t("eventAdmin.tickets.add")}</span>
        </h2>
      </header>

      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="size-5" />
                  {t("eventAdmin.typeEditor.details.title")}
                </CardTitle>
                <CardDescription>{t("eventAdmin.typeEditor.details.hint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <form.Field name="name">
                    {(field) => (
                      <TextField field={field} label={t("eventAdmin.typeEditor.details.name")} placeholder={t("eventAdmin.typeEditor.details.namePlaceholder")} maxLength={100} disabled={locked} />
                    )}
                  </form.Field>
                  <form.Field name="description">
                    {(field) => (
                      <TextField
                        field={field}
                        label={t("eventAdmin.typeEditor.details.description")}
                        multiline
                        placeholder={t("eventAdmin.typeEditor.details.descriptionPlaceholder")}
                        disabled={locked}
                      />
                    )}
                  </form.Field>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <form.Field name="price">
                      {(field) => (
                        <TextField
                          field={field}
                          label={t("eventAdmin.typeEditor.details.price")}
                          type="number"
                          inputMode="numeric"
                          suffix={t("eventAdmin.typeEditor.details.baht")}
                          description={t("eventAdmin.typeEditor.details.priceHint", { min: MIN_PAID_PRICE })}
                          disabled={locked}
                        />
                      )}
                    </form.Field>
                    <form.Field name="maxPerUser">
                      {(field) => (
                        <TextField
                          field={field}
                          label={t("eventAdmin.typeEditor.details.maxPerUser")}
                          type="number"
                          inputMode="numeric"
                          suffix={t("eventAdmin.typeEditor.details.tickets")}
                          description={t("eventAdmin.typeEditor.details.maxPerUserHint")}
                          disabled={locked}
                        />
                      )}
                    </form.Field>
                    {values.kind === "first_come" && (
                      <form.Field name="quota">
                        {(field) => (
                          <TextField
                            field={field}
                            label={t("eventAdmin.typeEditor.details.quota")}
                            type="number"
                            inputMode="numeric"
                            suffix={t("eventAdmin.typeEditor.details.tickets")}
                            description={
                              availability?.remaining != null && ticketType
                                ? t("eventAdmin.typeEditor.details.quotaTaken", { n: formatNumber(taken) })
                                : t("eventAdmin.typeEditor.details.quotaHint")
                            }
                            disabled={locked}
                          />
                        )}
                      </form.Field>
                    )}
                  </div>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="size-5" />
                  {t("eventAdmin.typeEditor.form.title")}
                </CardTitle>
                <CardDescription>
                  {t("eventAdmin.typeEditor.form.hint")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <QuestionBuilder form={form} disabled={locked} />
              </CardContent>
            </Card>
          </div>

          <aside className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-5" />
                  {t("eventAdmin.typeEditor.kind.title")}
                </CardTitle>
                <CardDescription>{t("eventAdmin.typeEditor.kind.hint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <form.Field name="kind">
                    {(field) => (
                      <RadioGroup
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value as TicketKind)}
                        disabled={locked || kindLocked}
                        aria-label={t("eventAdmin.typeEditor.kind.title")}
                        aria-invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                      >
                        {(Object.keys(kindInfo) as TicketKind[]).map((kind) => {
                          const { icon: Icon, label, description } = kindInfo[kind];
                          return (
                            <FieldLabel key={kind} htmlFor={`kind-${kind}`}>
                              <Field orientation="horizontal">
                                <FieldContent>
                                  <FieldTitle>
                                    <Icon className="size-4 text-muted-foreground" />
                                    {label}
                                  </FieldTitle>
                                  <FieldDescription>{description}</FieldDescription>
                                </FieldContent>
                                <RadioGroupItem value={kind} id={`kind-${kind}`} />
                              </Field>
                            </FieldLabel>
                          );
                        })}
                      </RadioGroup>
                    )}
                  </form.Field>
                  {kindLocked && (
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Lock className="mt-0.5 size-4 shrink-0" />
                      {t("eventAdmin.typeEditor.kind.locked")}
                    </p>
                  )}
                  {values.kind === "invite" && event.status !== "invite" && (
                    <Alert>
                      <Info />
                      <AlertTitle>{t("eventAdmin.typeEditor.kind.inviteTitle")}</AlertTitle>
                      <AlertDescription>
                        {t("eventAdmin.typeEditor.kind.inviteDescription")}
                      </AlertDescription>
                    </Alert>
                  )}
                </FieldGroup>
              </CardContent>
            </Card>

            {ticketType && availability && (
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ticket className="size-5" />
                    {t("eventAdmin.typeEditor.stats.title")}
                  </CardTitle>
                  <CardDescription>
                    {ticketType.price > 0
                      ? t("eventAdmin.typeEditor.stats.perTicket", { price: formatPrice(ticketType.price) })
                      : formatPrice(ticketType.price)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Stat label={t("eventAdmin.tickets.card.confirmed")} value={availability.confirmed} />
                    {ticketType.price > 0 && <Stat label={t("eventAdmin.tickets.card.awaitingPayment")} value={availability.reserved} />}
                    {ticketType.kind === "first_come" && <Stat label={t("eventAdmin.typeEditor.stats.filling")} value={availability.held} />}
                    {ticketType.kind === "approval" && <Stat label={t("eventAdmin.tickets.card.pending")} value={availability.pending} />}
                    {availability.remaining !== null && <Stat label={t("eventAdmin.tickets.card.remaining")} value={availability.remaining} />}
                  </dl>
                </CardContent>
              </Card>
            )}

            {ticketType && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <Trash2 className="size-5" />
                    {t("eventAdmin.tickets.delete.confirm")}
                  </CardTitle>
                  <CardDescription>{t("eventAdmin.typeEditor.delete.hint")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button type="button" variant="destructive" disabled={locked || held > 0} onClick={() => setDeleteOpen(true)}>
                    <Trash2 data-icon="inline-start" />
                    {t("eventAdmin.typeEditor.delete.button")}
                  </Button>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>

        {ticketType ? (
          <SaveBar
            changes={changes}
            saving={isSubmitting}
            disabled={locked}
            onSave={() => void form.handleSubmit()}
            onDiscard={() => form.reset(baseline)}
            allowLeaveRef={allowLeave}
          />
        ) : (
          <>
            <Card size="sm">
              <CardFooter className="flex flex-wrap justify-end gap-2">
                <Link to="/dashboard/events/$eventId/tickets" params={listParams} className={buttonVariants({ variant: "ghost" })}>
                  <ArrowLeft data-icon="inline-start" />
                  {t("eventAdmin.typeEditor.cancel")}
                </Link>
                <SubmitButton pending={isSubmitting} icon={TicketPlus} disabled={locked}>
                  {t("eventAdmin.typeEditor.create")}
                </SubmitButton>
              </CardFooter>
            </Card>
            <LeaveGuard when={changes > 0} allowLeaveRef={allowLeave} />
          </>
        )}
      </form>

      {ticketType && (
        <DeleteTicketTypeDialog
          eventId={event.id}
          ticketType={ticketType}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={() => {
            allowLeave.current = true;
            return navigate({ to: "/dashboard/events/$eventId/tickets", params: listParams });
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{formatNumber(value)}</dd>
    </div>
  );
}
