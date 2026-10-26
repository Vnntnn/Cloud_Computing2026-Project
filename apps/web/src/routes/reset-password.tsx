import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert, KeyRound, RotateCcwKey } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AuthLayout } from "@/components/auth-layout";
import { SubmitButton, TextField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { t, useT } from "@/i18n";
import { auth } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { redirectIfSignedIn } from "@/lib/session";

export const Route = createFileRoute("/reset-password")({
  staticData: { title: "pub.auth.reset.title" },
  // Better Auth redirects here with ?token=... (or ?error=INVALID_TOKEN) from the emailed link
  validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
  beforeLoad: ({ context }) => redirectIfSignedIn(context.queryClient),
  component: ResetPasswordPage,
});

const resetSchema = z
  .object({
    password: z.string().min(8, { error: () => t("pub.auth.errors.passwordMin") }).max(128, { error: () => t("pub.auth.errors.passwordMax") }),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    error: () => t("pub.auth.errors.passwordMismatch"),
    path: ["confirmPassword"],
  });

function ResetPasswordPage() {
  const t = useT();
  const { token, error } = Route.useSearch();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { password: "", confirmPassword: "" },
    validators: { onSubmit: resetSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await auth.resetPassword({ newPassword: value.password, token });
      if (result.error) return setFormError(authErrorMessage(result.error));
      toast.add({ type: "success", title: t("pub.auth.reset.doneTitle"), description: t("pub.auth.reset.doneDescription") });
      await navigate({ to: "/login" });
    },
  });

  return (
    <AuthLayout title={t("pub.auth.reset.title")} description={t("pub.auth.reset.description")}>
      {!token || error ? (
        <>
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{authErrorMessage(error ?? "INVALID_TOKEN")}</AlertDescription>
          </Alert>
          <Link to="/forgot-password" className={buttonVariants({ variant: "outline", size: "lg" })}>
            <KeyRound data-icon="inline-start" />
            {t("pub.auth.reset.requestNew")}
          </Link>
        </>
      ) : (
        <>
          {formError && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.Field name="password">
                {(field) => (
                  <TextField
                    field={field}
                    label={t("pub.auth.reset.newPassword")}
                    type="password"
                    autoComplete="new-password"
                    description={t("pub.auth.passwordHint")}
                  />
                )}
              </form.Field>
              <form.Field name="confirmPassword">
                {(field) => (
                  <TextField field={field} label={t("pub.auth.reset.confirmNewPassword")} type="password" autoComplete="new-password" />
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <SubmitButton pending={isSubmitting} icon={RotateCcwKey} size="lg">
                    {t("pub.auth.reset.submit")}
                  </SubmitButton>
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
