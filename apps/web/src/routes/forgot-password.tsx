import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CircleAlert, MailCheck, Send } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AuthLayout } from "@/components/auth-layout";
import { SubmitButton, TextField } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { t, useT } from "@/i18n";
import { auth } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { redirectIfSignedIn } from "@/lib/session";

export const Route = createFileRoute("/forgot-password")({
  staticData: { title: "pub.auth.forgot.title" },
  beforeLoad: ({ context }) => redirectIfSignedIn(context.queryClient),
  component: ForgotPasswordPage,
});

const forgotSchema = z.object({ email: z.email({ error: () => t("pub.auth.errors.email") }) });

function ForgotPasswordPage() {
  const t = useT();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "" },
    validators: { onSubmit: forgotSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const { error } = await auth.requestPasswordReset({
        email: value.email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) return setFormError(authErrorMessage(error));
      // same answer whether or not the email exists, so accounts can't be probed
      setSentTo(value.email);
    },
  });

  return (
    <AuthLayout
      title={t("pub.auth.forgot.title")}
      description={t("pub.auth.forgot.description")}
      footer={
        <Link to="/login" className="flex items-center gap-1 font-medium text-primary dark:text-chart-2 hover:underline">
          <ArrowLeft className="size-4" />
          {t("pub.auth.forgot.back")}
        </Link>
      }
    >
      {sentTo ? (
        <Alert>
          <MailCheck />
          <AlertTitle>{t("pub.auth.forgot.sentTitle")}</AlertTitle>
          <AlertDescription>{t("pub.auth.forgot.sentDescription", { email: sentTo })}</AlertDescription>
        </Alert>
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
              <form.Field name="email">
                {(field) => (
                  <TextField field={field} label={t("pub.auth.email")} type="email" autoComplete="email" placeholder="you@example.com" />
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <SubmitButton pending={isSubmitting} icon={Send} size="lg">
                    {t("pub.auth.forgot.submit")}
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
