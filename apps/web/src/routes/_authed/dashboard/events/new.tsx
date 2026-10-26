import { useForm, useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarPlus } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { CategorySelect } from "@/components/category-select";
import { DateTimeField } from "@/components/date-time-picker";
import { SubmitButton, TextField } from "@/components/form-field";
import { LeaveGuard } from "@/components/leave-guard";
import { PageHeader } from "@/components/page-header";
import { SlugField } from "@/components/slug-field";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { t, useT } from "@/i18n";
import { eventClient } from "@/lib/api";
import { problemMessage } from "@/lib/auth-errors";
import { eventDetailKey, eventsKey, fromLocalInput, problemCode, problemFields, shiftEnd, SLUG_REGEX } from "@/lib/events";
import { formatDuration } from "@/lib/format";
import { focusFirstInvalid } from "./-components/event-form";

export const Route = createFileRoute("/_authed/dashboard/events/new")({
  staticData: { title: "dashboard.events.new.title" }, component: NewEventPage });

const ROOT = "[data-slot=new-event]";

const schema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { error: () => t("dashboard.eventForm.titleRequired") })
      .max(150, { error: () => t("dashboard.eventForm.titleMax") }),
    categoryId: z.string().min(1, { error: () => t("dashboard.eventForm.categoryRequired") }),
    startsAt: z.string().min(1, { error: () => t("dashboard.eventForm.startRequired") }),
    endsAt: z.string().min(1, { error: () => t("dashboard.eventForm.endRequired") }),
    venue: z
      .string()
      .trim()
      .min(1, { error: () => t("dashboard.eventForm.venueRequired") })
      .max(200, { error: () => t("dashboard.eventForm.venueMax") }),
    slug: z.string().refine((v) => v === "" || (v.length >= 3 && v.length <= 80 && SLUG_REGEX.test(v)), {
      error: () => t("dashboard.eventForm.slugInvalid"),
    }),
  })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), {
    path: ["endsAt"],
    error: () => t("dashboard.eventForm.endAfterStart"),
  });

const defaultValues = { title: "", categoryId: "", startsAt: "", endsAt: "", venue: "", slug: "" };

function NewEventPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const previousStart = useRef("");
  const created = useRef(false);

  const form = useForm({
    defaultValues,
    validators: { onSubmit: schema },
    listeners: {
      onChange: ({ fieldApi }) => {
        const { errorMap } = fieldApi.state.meta;
        if (errorMap.onServer) fieldApi.setErrorMap({ ...errorMap, onServer: undefined });
      },
    },
    onSubmitInvalid: () => focusFirstInvalid(ROOT),
    onSubmit: async ({ value }) => {
      const { data, error } = await eventClient.api.events.post({
        title: value.title.trim(),
        categoryId: value.categoryId,
        venue: value.venue.trim(),
        slug: value.slug || undefined,
        startsAt: fromLocalInput(value.startsAt),
        endsAt: fromLocalInput(value.endsAt),
      });
      if (error) {
        const code = problemCode(error);
        const field = code ? (problemFields[code] as keyof typeof defaultValues | undefined) : undefined;
        if (field) {
          form.setFieldMeta(field, (meta) => ({
            ...meta,
            isTouched: true,
            errorMap: { ...meta.errorMap, onServer: { message: problemMessage(error) } },
          }));
          focusFirstInvalid(ROOT);
        }
        return void toast.add({ type: "error", title: problemMessage(error) });
      }
      created.current = true;
      queryClient.setQueryData(eventDetailKey(data.id), data);
      void queryClient.invalidateQueries({ queryKey: [...eventsKey, "mine"] });
      toast.add({
        type: "success",
        title: t("dashboard.events.new.created"),
        description: t("dashboard.events.new.createdDescription"),
      });
      await navigate({ to: "/dashboard/events/$eventId", params: { eventId: data.id } });
    },
  });

  const dirty = useStore(form.store, (state) => state.isDirty);

  // dates before today can't be picked
  const [today] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  return (
    <div data-slot="new-event" className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link to="/dashboard/events" className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}>
        <ArrowLeft data-icon="inline-start" />
        {t("dashboard.events.new.back")}
      </Link>
      <PageHeader
        icon={CalendarPlus}
        title={t("dashboard.events.new.title")}
        description={t("dashboard.events.new.description")}
      />
      <Card>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <CardContent>
            <FieldGroup>
              <FieldSet>
                <FieldLegend>{t("dashboard.events.new.yourEvent")}</FieldLegend>
                <FieldGroup>
                  <form.Field name="title">
                    {(field) => (
                      <TextField
                        field={field}
                        label={t("dashboard.events.new.titleLabel")}
                        placeholder={t("dashboard.events.new.titlePlaceholder")}
                        maxLength={150}
                        autoFocus
                      />
                    )}
                  </form.Field>
                  <form.Field name="categoryId">
                    {(field) => (
                      <CategorySelect
                        value={field.state.value}
                        onValueChange={field.handleChange}
                        onBlur={field.handleBlur}
                        invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                        errors={field.state.meta.errors}
                      />
                    )}
                  </form.Field>
                </FieldGroup>
              </FieldSet>
              <FieldSeparator />
              <FieldSet>
                <FieldLegend>{t("dashboard.events.new.dateTime")}</FieldLegend>
                <FieldGroup className="grid gap-6 sm:grid-cols-2">
                  <form.Field
                    name="startsAt"
                    listeners={{
                      onChange: ({ value }) => {
                        const end = form.getFieldValue("endsAt");
                        const shifted = shiftEnd(previousStart.current, value, end);
                        previousStart.current = value;
                        if (shifted !== end) form.setFieldValue("endsAt", shifted);
                      },
                    }}
                  >
                    {(field) => <DateTimeField field={field} label={t("dashboard.events.new.starts")} fromDate={today} />}
                  </form.Field>
                  <form.Subscribe selector={(state) => state.values.startsAt}>
                    {(startsAt) => (
                      <form.Field name="endsAt">
                        {(field) => {
                          const length = new Date(field.state.value).getTime() - new Date(startsAt).getTime();
                          return (
                            <DateTimeField
                              field={field}
                              label={t("dashboard.events.new.ends")}
                              fromDate={today}
                              description={length > 0 ? t("dashboard.events.new.duration", { duration: formatDuration(length) }) : undefined}
                            />
                          );
                        }}
                      </form.Field>
                    )}
                  </form.Subscribe>
                </FieldGroup>
              </FieldSet>
              <FieldSeparator />
              <FieldSet>
                <FieldLegend>{t("dashboard.events.new.venueAndLink")}</FieldLegend>
                <FieldGroup>
                  <form.Field name="venue">
                    {(field) => (
                      <TextField
                        field={field}
                        label={t("dashboard.events.new.venueLabel")}
                        placeholder={t("dashboard.events.new.venuePlaceholder")}
                        maxLength={200}
                      />
                    )}
                  </form.Field>
                  <form.Field name="slug">{(field) => <SlugField field={field} optional />}</form.Field>
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </CardContent>
          <CardFooter className="mt-6 flex flex-wrap justify-end gap-2">
            <Link to="/dashboard/events" className={buttonVariants({ variant: "ghost" })}>
              <ArrowLeft data-icon="inline-start" />
              {t("dashboard.events.new.cancel")}
            </Link>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <SubmitButton pending={isSubmitting} icon={CalendarPlus}>
                  {t("dashboard.events.new.submit")}
                </SubmitButton>
              )}
            </form.Subscribe>
          </CardFooter>
        </form>
      </Card>
      <LeaveGuard
        when={dirty}
        allowLeaveRef={created}
        title={t("dashboard.events.new.leaveTitle")}
        description={t("dashboard.events.new.leaveDescription")}
      />
    </div>
  );
}
