import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Ban, CalendarRange, Circle, CircleCheck, Eye, FileText, ImageIcon, Info, ListChecks, MailPlus, MapPin, Receipt, ShieldAlert, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { CoverImageField } from "@/components/cover-image-field";
import { DateTimeField } from "@/components/date-time-picker";
import { TextField } from "@/components/form-field";
import { RichTextEditor } from "@/components/rich-text-editor";
import { SlugField } from "@/components/slug-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { eventClient } from "@/lib/api";
import { problemMessage } from "@/lib/auth-errors";
import {
  eventDetailKey,
  eventsKey,
  problemCode,
  problemFields,
  shiftEnd,
  statusInfo,
  type EventDetail,
  type EventStatus,
} from "@/lib/events";
import { useT } from "@/i18n";
import { formatDuration } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
import { DeleteEventDialog } from "../-components/delete-event-dialog";
import {
  diffPayload,
  eventFormSchema,
  focusFirstInvalid,
  toFormValues,
  type EventFormValues,
} from "../-components/event-form";
import { SaveBar } from "../-components/save-bar";
import { useEventDetail } from "./-components/use-event-detail";

export const Route = createFileRoute("/_authed/dashboard/events/$eventId/")({ component: EditEventPage });

const ROOT = "[data-slot=event-editor]";
const CUTOFF_HOURS = ["24", "72", "168"];
const PERCENT_PRESETS = ["50", "80", "100"];

function EditEventPage() {
  const event = useEventDetail();
  return <EventEditor key={event.id} event={event} />;
}

function EventEditor({ event }: { event: EventDetail }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isAdmin = hasRole(session?.user, ["admin"]);
  // a suspended event is frozen for its organizer until an admin lifts it
  const locked = event.status === "suspended" && !isAdmin;
  // what the form compares against: the event as last loaded or saved here (not every refetch,
  // so a background refetch never turns someone else's change into one of ours)
  const [baseline, setBaseline] = useState(() => toFormValues(event));
  const previousStart = useRef(baseline.startsAt);
  const allowLeave = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // "now" for this visit: the earliest day a publish time can be set to, and whether the event is still ahead
  const [now] = useState(() => new Date());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const refreshLists = () =>
    queryClient.invalidateQueries({ queryKey: eventsKey, predicate: (query) => query.queryKey[1] !== "detail" });

  const form = useForm({
    defaultValues: baseline,
    validators: { onSubmit: eventFormSchema },
    listeners: {
      // a server error (e.g. slug taken) sticks to its field until that field changes
      onChange: ({ fieldApi }) => {
        const { errorMap } = fieldApi.state.meta;
        if (errorMap.onServer) fieldApi.setErrorMap({ ...errorMap, onServer: undefined });
      },
    },
    onSubmitInvalid: () => {
      toast.add({ type: "error", title: t("eventAdmin.editor.invalid") });
      focusFirstInvalid(ROOT);
    },
    onSubmit: async ({ value }) => {
      const patch = diffPayload(value, baseline);
      if (Object.keys(patch).length === 0) return;
      const { data, error } = await eventClient.api.events({ id: event.id }).patch(patch);
      if (error) return showProblem(error);
      queryClient.setQueryData(eventDetailKey(event.id), data);
      const next = toFormValues(data);
      setBaseline(next);
      form.reset(next);
      previousStart.current = next.startsAt;
      toast.add({ type: "success", title: t("eventAdmin.editor.saved") });
      void refreshLists();
    },
  });

  function showProblem(error: unknown) {
    const code = problemCode(error);
    const message = problemMessage(error);
    const field = code ? (problemFields[code] as keyof EventFormValues | undefined) : undefined;
    if (field) {
      form.setFieldMeta(field, (meta) => ({ ...meta, isTouched: true, errorMap: { ...meta.errorMap, onServer: { message } } }));
      focusFirstInvalid(ROOT);
    }
    // e.g. an admin suspended it meanwhile: reload so the editor shows why
    if (code === "EVENT_SUSPENDED") void queryClient.invalidateQueries({ queryKey: eventDetailKey(event.id) });
    toast.add({ type: "error", title: message });
  }

  function discard() {
    form.reset(baseline);
    previousStart.current = baseline.startsAt;
  }

  const setStatus = useMutation({
    mutationFn: async (status: EventStatus) => {
      const { data, error } = await eventClient.api.events({ id: event.id }).patch({ status });
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(eventDetailKey(saved.id), saved);
      // only the status moved on the server; other unsaved edits stay as they are
      setBaseline((current) => ({ ...current, status: saved.status }));
      form.setFieldValue("status", saved.status);
      toast.add({
        type: "success",
        title: saved.status === "suspended" ? t("eventAdmin.editor.suspendedToast") : t("eventAdmin.editor.liftedToast"),
      });
      void refreshLists();
    },
    onError: showProblem,
  });

  async function uploadCover(file: File) {
    const { data, error } = await eventClient.api.events({ id: event.id }).cover.put({ file });
    if (error) throw new Error(problemMessage(error));
    queryClient.setQueryData<EventDetail>(eventDetailKey(event.id), (old) => old && { ...old, thumbnailUrl: data.coverUrl });
    void refreshLists();
  }

  async function removeCover() {
    const { error } = await eventClient.api.events({ id: event.id }).cover.delete();
    if (error) throw new Error(problemMessage(error));
    queryClient.setQueryData<EventDetail>(eventDetailKey(event.id), (old) => old && { ...old, thumbnailUrl: null });
    void refreshLists();
  }

  async function uploadImage(file: File) {
    const { data, error } = await eventClient.api.events({ id: event.id }).assets.post({ file });
    if (error) throw new Error(problemMessage(error));
    return data.url;
  }

  return (
    <div data-slot="event-editor" className="flex flex-col gap-6">
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
                  {t("eventAdmin.editor.basic.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <form.Field name="title">
                    {(field) => <TextField field={field} label={t("eventAdmin.editor.basic.name")} maxLength={150} disabled={locked} />}
                  </form.Field>
                  <form.Field name="categoryId">
                    {(field) => (
                      <CategorySelect
                        value={field.state.value}
                        onValueChange={field.handleChange}
                        onBlur={field.handleBlur}
                        invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                        errors={field.state.meta.errors}
                        disabled={locked}
                      />
                    )}
                  </form.Field>
                  <form.Field name="slug">
                    {(field) => <SlugField field={field} excludeId={event.id} current={baseline.slug} disabled={locked} />}
                  </form.Field>
                  <form.Subscribe selector={(state) => state.values.slug}>
                    {(slug) =>
                      slug !== baseline.slug &&
                      event.status === "public" && (
                        <Alert>
                          <TriangleAlert />
                          <AlertTitle>{t("eventAdmin.editor.basic.slugChanged.title")}</AlertTitle>
                          <AlertDescription>
                            {t("eventAdmin.editor.basic.slugChanged.description", { slug: baseline.slug })}
                          </AlertDescription>
                        </Alert>
                      )
                    }
                  </form.Subscribe>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarRange className="size-5" />
                  {t("eventAdmin.editor.when.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup className="grid gap-6 sm:grid-cols-2">
                  <form.Field
                    name="startsAt"
                    listeners={{
                      onChange: ({ value }) => {
                        // moving the start keeps the length, like a calendar app
                        const end = form.getFieldValue("endsAt");
                        const shifted = shiftEnd(previousStart.current, value, end);
                        previousStart.current = value;
                        if (shifted !== end) form.setFieldValue("endsAt", shifted);
                      },
                    }}
                  >
                    {(field) => <DateTimeField field={field} label={t("eventAdmin.editor.when.start")} disabled={locked} />}
                  </form.Field>
                  <form.Subscribe selector={(state) => state.values.startsAt}>
                    {(startsAt) => (
                      <form.Field name="endsAt">
                        {(field) => {
                          const length = new Date(field.state.value).getTime() - new Date(startsAt).getTime();
                          return (
                            <DateTimeField
                              field={field}
                              label={t("eventAdmin.editor.when.end")}
                              disabled={locked}
                              description={length > 0 ? t("eventAdmin.editor.when.duration", { duration: formatDuration(length) }) : undefined}
                            />
                          );
                        }}
                      </form.Field>
                    )}
                  </form.Subscribe>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="size-5" />
                  {t("eventAdmin.editor.venue.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <form.Field name="venue">
                    {(field) => (
                      <TextField
                        field={field}
                        label={t("eventAdmin.editor.venue.name")}
                        placeholder={t("eventAdmin.editor.venue.namePlaceholder")}
                        maxLength={200}
                        disabled={locked}
                      />
                    )}
                  </form.Field>
                  <form.Field name="venueDescription">
                    {(field) => (
                      <TextField
                        field={field}
                        label={t("eventAdmin.editor.venue.directions")}
                        multiline
                        placeholder={t("eventAdmin.editor.venue.directionsPlaceholder")}
                        disabled={locked}
                      />
                    )}
                  </form.Field>
                  <form.Field name="venueUrl">
                    {(field) => (
                      <TextField
                        field={field}
                        label={t("eventAdmin.editor.venue.mapUrl")}
                        type="url"
                        inputMode="url"
                        placeholder="https://maps.app.goo.gl/..."
                        description={t("eventAdmin.editor.venue.mapUrlHint")}
                        disabled={locked}
                      />
                    )}
                  </form.Field>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-5" />
                  {t("eventAdmin.editor.description.title")}
                </CardTitle>
                <CardDescription>{t("eventAdmin.editor.description.hint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <form.Field name="description">
                  {(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={isInvalid}>
                        <RichTextEditor
                          value={field.state.value}
                          onChange={field.handleChange}
                          onUploadImage={uploadImage}
                          allowedImagePrefix={`/files/public/events/${event.id}/assets/`}
                          disabled={locked}
                          invalid={isInvalid}
                        />
                        {isInvalid && <FieldError errors={field.state.meta.errors} />}
                      </Field>
                    );
                  }}
                </form.Field>
              </CardContent>
            </Card>
          </div>

          <aside className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="size-5" />
                  {t("eventAdmin.editor.publish.title")}
                </CardTitle>
                <CardDescription>{t("eventAdmin.editor.publish.hint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <form.Field name="status">
                    {(field) => (
                      <RadioGroup
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value as EventStatus)}
                        disabled={locked}
                        aria-label={t("eventAdmin.editor.publish.status")}
                      >
                        {(["draft", "public", "invite"] as const).map((status) => {
                          const { icon: Icon, label, description } = statusInfo[status];
                          return (
                            <FieldLabel key={status} htmlFor={`status-${status}`}>
                              <Field orientation="horizontal">
                                <FieldContent>
                                  <FieldTitle>
                                    <Icon className="size-4 text-muted-foreground" />
                                    {label}
                                  </FieldTitle>
                                  <FieldDescription>{description}</FieldDescription>
                                </FieldContent>
                                <RadioGroupItem value={status} id={`status-${status}`} />
                              </Field>
                            </FieldLabel>
                          );
                        })}
                      </RadioGroup>
                    )}
                  </form.Field>
                  <form.Subscribe selector={(state) => state.values.status}>
                    {(status) =>
                      status === "invite" && (
                        <Link
                          to="/dashboard/events/$eventId/invitations"
                          params={{ eventId: event.id }}
                          className={buttonVariants({ variant: "outline", className: "self-start" })}
                        >
                          <MailPlus data-icon="inline-start" />
                          {t("eventAdmin.editor.publish.manageInvitations")}
                        </Link>
                      )
                    }
                  </form.Subscribe>
                  <form.Subscribe selector={(state) => [state.values.status, state.values.schedulePublish] as const}>
                    {([status, schedulePublish]) =>
                      status === "public" && (
                        <>
                          <form.Field name="schedulePublish">
                            {(field) => (
                              <Field orientation="horizontal">
                                <Switch
                                  id="schedulePublish"
                                  checked={field.state.value}
                                  onCheckedChange={field.handleChange}
                                  disabled={locked}
                                />
                                <FieldContent>
                                  <FieldLabel htmlFor="schedulePublish">{t("eventAdmin.editor.publish.schedule")}</FieldLabel>
                                  <FieldDescription>{t("eventAdmin.editor.publish.scheduleHint")}</FieldDescription>
                                </FieldContent>
                              </Field>
                            )}
                          </form.Field>
                          {schedulePublish && (
                            <form.Field name="publishAt">
                              {(field) => (
                                <DateTimeField
                                  field={field}
                                  label={t("eventAdmin.editor.publish.publishAt")}
                                  fromDate={today}
                                  disabled={locked}
                                />
                              )}
                            </form.Field>
                          )}
                        </>
                      )
                    }
                  </form.Subscribe>
                </FieldGroup>
              </CardContent>
            </Card>

            <form.Subscribe selector={(state) => [state.values.description, state.values.startsAt] as const}>
              {([description, startsAt]) => (
                <Readiness
                  items={[
                    { label: t("eventAdmin.editor.readiness.cover"), done: !!event.thumbnailUrl, hint: t("eventAdmin.editor.readiness.coverHint") },
                    {
                      label: t("eventAdmin.editor.readiness.description"),
                      done: /<img/.test(description) || description.replace(/<[^>]*>/g, "").trim().length >= 50,
                      hint: t("eventAdmin.editor.readiness.descriptionHint"),
                    },
                    { label: t("eventAdmin.editor.readiness.upcoming"), done: !!startsAt && new Date(startsAt) > now },
                  ]}
                />
              )}
            </form.Subscribe>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="size-5" />
                  {t("eventAdmin.editor.cover.title")}
                </CardTitle>
                <CardDescription>{t("eventAdmin.editor.cover.hint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <CoverImageField
                  imageUrl={event.thumbnailUrl}
                  onUpload={uploadCover}
                  onRemove={removeCover}
                  disabled={locked}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="size-5" />
                  {t("eventAdmin.editor.refund.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <form.Field name="isRefundAvailable">
                    {(field) => (
                      <Field orientation="horizontal">
                        <Switch
                          id="isRefundAvailable"
                          checked={field.state.value}
                          onCheckedChange={field.handleChange}
                          disabled={locked}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor="isRefundAvailable">{t("eventAdmin.editor.refund.enable")}</FieldLabel>
                          <FieldDescription>
                            {t("eventAdmin.editor.refund.enableHint")}
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    )}
                  </form.Field>
                  <form.Subscribe
                    selector={(state) =>
                      [state.values.isRefundAvailable, state.values.refundCutoffHours, state.values.refundPercent] as const
                    }
                  >
                    {([enabled, hours, percent]) =>
                      enabled ? (
                        <>
                          <form.Field name="refundCutoffHours">
                            {(field) => (
                              <div className="flex flex-col gap-2">
                                <TextField
                                  field={field}
                                  label={t("eventAdmin.editor.refund.cutoff")}
                                  type="number"
                                  inputMode="numeric"
                                  suffix={t("eventAdmin.editor.refund.hours")}
                                  disabled={locked}
                                />
                                <Presets
                                  label={t("eventAdmin.editor.refund.cutoffPresets")}
                                  value={field.state.value}
                                  options={CUTOFF_HOURS.map((hours) => ({ value: hours, label: formatDuration(Number(hours) * 3_600_000) }))}
                                  onPick={field.handleChange}
                                  disabled={locked}
                                />
                              </div>
                            )}
                          </form.Field>
                          <form.Field name="refundPercent">
                            {(field) => (
                              <div className="flex flex-col gap-2">
                                <TextField
                                  field={field}
                                  label={t("eventAdmin.editor.refund.percent")}
                                  type="number"
                                  inputMode="numeric"
                                  suffix="%"
                                  disabled={locked}
                                />
                                <Presets
                                  label={t("eventAdmin.editor.refund.percentPresets")}
                                  value={field.state.value}
                                  options={PERCENT_PRESETS.map((p) => ({ value: p, label: `${p}%` }))}
                                  onPick={field.handleChange}
                                  disabled={locked}
                                />
                              </div>
                            )}
                          </form.Field>
                          {/^\d+$/.test(hours) && /^\d+$/.test(percent) && Number(percent) <= 100 && (
                            <p className="rounded-md bg-muted px-3 py-2 text-sm">
                              {t("eventAdmin.editor.refund.summary", {
                                percent: `${percent}%`,
                                duration: formatDuration(Number(hours) * 3_600_000),
                              })}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t("eventAdmin.editor.refund.off")}</p>
                      )
                    }
                  </form.Subscribe>
                </FieldGroup>
              </CardContent>
            </Card>

            {isAdmin && (
              <Moderation
                suspended={event.status === "suspended"}
                pending={setStatus.isPending}
                onSuspend={() => setStatus.mutate("suspended")}
                onLift={() => setStatus.mutate("draft")}
              />
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <Trash2 className="size-5" />
                  {t("eventAdmin.editor.delete.title")}
                </CardTitle>
                <CardDescription>{t("eventAdmin.editor.delete.hint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" variant="destructive" disabled={locked} onClick={() => setDeleteOpen(true)}>
                  <Trash2 data-icon="inline-start" />
                  {t("eventAdmin.editor.delete.button")}
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>

        <form.Subscribe selector={(state) => [state.values, state.isSubmitting] as const}>
          {([values, isSubmitting]) => (
            <SaveBar
              changes={Object.keys(diffPayload(values, baseline)).length}
              saving={isSubmitting}
              disabled={locked}
              onSave={() => void form.handleSubmit()}
              onDiscard={discard}
              allowLeaveRef={allowLeave}
            />
          )}
        </form.Subscribe>
      </form>

      <DeleteEventDialog
        event={event}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          allowLeave.current = true;
          return navigate({ to: "/dashboard/events" });
        }}
      />
    </div>
  );
}

/** Small pill buttons under an input that fill in a common value. */
function Presets({
  label,
  value,
  options,
  onPick,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      aria-label={label}
      value={[value]}
      disabled={disabled}
      onValueChange={(next: string[]) => next[0] && onPick(next[0])}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Checklist of what makes an event page complete. Advice only: publishing never waits on it. */
function Readiness({ items }: { items: { label: string; done: boolean; hint?: string }[] }) {
  const t = useT();
  const done = items.filter((item) => item.done).length;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-5" />
          {t("eventAdmin.editor.readiness.title")}
        </CardTitle>
        <CardDescription>
          {done === items.length ? t("eventAdmin.editor.readiness.complete") : t("eventAdmin.editor.readiness.progress", { done, total: items.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-2">
              {item.done ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary dark:text-chart-2" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex flex-col">
                <span className={item.done ? "text-muted-foreground" : undefined}>{item.label}</span>
                {!item.done && item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Admin-only: suspend (hide from everyone, freeze for the organizer) or lift it, right away. */
function Moderation({
  suspended,
  pending,
  onSuspend,
  onLift,
}: {
  suspended: boolean;
  pending: boolean;
  onSuspend: () => void;
  onLift: () => void;
}) {
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-5" />
          {t("eventAdmin.editor.moderation.title")}
        </CardTitle>
        <CardDescription>{t("eventAdmin.editor.moderation.hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        {suspended ? (
          <Button type="button" variant="outline" disabled={pending} onClick={onLift}>
            {pending ? <Spinner data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" />}
            {t("eventAdmin.editor.moderation.lift")}
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmOpen(true)}>
            <Ban data-icon="inline-start" />
            {t("eventAdmin.editor.moderation.suspend")}
          </Button>
        )}
      </CardContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Ban />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("eventAdmin.editor.moderation.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("eventAdmin.editor.moderation.confirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <ArrowLeft data-icon="inline-start" />
              {t("eventAdmin.editor.moderation.back")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onSuspend();
              }}
            >
              <Ban data-icon="inline-start" />
              {t("eventAdmin.editor.moderation.suspend")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
