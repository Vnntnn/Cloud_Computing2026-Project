import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, Pencil, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { SubmitButton, TextField } from "@/components/form-field";
import { RoleBadge } from "@/components/role-badge";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { useT, type Translate } from "@/i18n";
import { auth, type SessionUser } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { formatDate } from "@/lib/format";
import { refreshSession, useSession } from "@/lib/session";
import { AvatarPicker } from "./-components/avatar-picker";
import { Section } from "./-components/section";

export const Route = createFileRoute("/_authed/profile/")({
  staticData: { title: "account.profile.layout.nav.account" },
  component: AccountPage,
});

function AccountPage() {
  const guarded = Route.useRouteContext().session;
  const { data: session } = useSession();
  // the route guard guarantees a session; fall back to the guard's copy while refetching
  return <AccountSection user={session?.user ?? guarded.user} />;
}

const nameSchema = (t: Translate) =>
  z.object({
    name: z.string().trim().min(2, t("account.profile.account.errors.nameMin")).max(100, t("account.profile.account.errors.nameTooLong")),
    firstName: z.string().trim().max(100, t("account.profile.account.errors.nameTooLong")),
    lastName: z.string().trim().max(100, t("account.profile.account.errors.lastNameTooLong")),
  });

function AccountSection({ user }: { user: SessionUser }) {
  const t = useT();
  const schema = useMemo(() => nameSchema(t), [t]);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  const form = useForm({
    defaultValues: { name: user.name, firstName: user.firstName ?? "", lastName: user.lastName ?? "" },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const { error } = await auth.updateUser({
        name: value.name.trim(),
        firstName: value.firstName.trim() || null,
        lastName: value.lastName.trim() || null,
      });
      if (error) return void toast.add({ type: "error", title: authErrorMessage(error) });
      await refreshSession(queryClient);
      toast.add({ type: "success", title: t("account.profile.account.saved") });
      setEditing(false);
    },
  });

  return (
    <Section title={t("account.profile.account.title")} description={t("account.profile.account.memberSince", { date: formatDate(user.createdAt) })}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <AvatarPicker user={user} />
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xl font-bold break-words">{user.name}</span>
            <RoleBadge role={user.role} />
          </span>
          <span className="flex items-center gap-1.5 text-sm break-all text-muted-foreground">
            <Mail className="size-4 shrink-0" />
            {user.email}
          </span>
          <span className="text-sm text-muted-foreground">{fullName || t("account.profile.account.noRealName")}</span>
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
            <Pencil data-icon="inline-start" />
            {t("account.profile.account.editName")}
          </Button>
        )}
      </div>
      {editing && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="name">
              {(field) => <TextField field={field} label={t("account.profile.account.displayName")} autoComplete="name" autoFocus />}
            </form.Field>
            <div className="grid gap-6 sm:grid-cols-2">
              <form.Field name="firstName">
                {(field) => (
                  <TextField field={field} label={t("account.profile.account.firstName")} autoComplete="given-name" maxLength={100} />
                )}
              </form.Field>
              <form.Field name="lastName">
                {(field) => (
                  <TextField field={field} label={t("account.profile.account.lastName")} autoComplete="family-name" maxLength={100} />
                )}
              </form.Field>
            </div>
            <FieldDescription>{t("account.profile.account.nameHint")}</FieldDescription>
            <div className="flex gap-2">
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <SubmitButton pending={isSubmitting} icon={Save}>
                    {t("account.profile.account.save")}
                  </SubmitButton>
                )}
              </form.Subscribe>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  form.reset();
                  setEditing(false);
                }}
              >
                {t("account.profile.account.cancel")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      )}
    </Section>
  );
}
