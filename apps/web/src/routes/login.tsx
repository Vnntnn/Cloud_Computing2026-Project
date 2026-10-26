import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert, LogIn } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AuthLayout } from "@/components/auth-layout";
import { SubmitButton, TextField } from "@/components/form-field";
import { GoogleSignIn } from "@/components/google-sign-in";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { t, useT } from "@/i18n";
import { auth } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { redirectIfSignedIn, refreshSession, safeRedirect } from "@/lib/session";

export const Route = createFileRoute("/login")({
  staticData: { title: "pub.auth.login.title" },
  validateSearch: z.object({
    redirect: z.string().optional(),
    // set by Better Auth when a Google sign-in fails
    error: z.string().optional(),
  }),
  beforeLoad: ({ context, search }) => redirectIfSignedIn(context.queryClient, search.redirect),
  component: LoginPage,
});

const loginSchema = z.object({
  email: z.email({ error: () => t("pub.auth.errors.email") }),
  password: z.string().min(1, { error: () => t("pub.auth.errors.passwordRequired") }),
});

function LoginPage() {
  const t = useT();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const target = safeRedirect(search.redirect);
  const [formError, setFormError] = useState<string | null>(
    search.error ? authErrorMessage(search.error) : null,
  );

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const { error } = await auth.signIn.email(value);
      if (error) return setFormError(authErrorMessage(error));
      await refreshSession(queryClient);
      await navigate({ href: target });
    },
  });

  return (
    <AuthLayout
      title={t("pub.auth.login.title")}
      description={t("pub.auth.login.description")}
      footer={
        <>
          {t("pub.auth.login.noAccount")}
          <Link to="/register" search={{ redirect: search.redirect }} className="font-medium text-primary dark:text-chart-2 hover:underline">
            {t("pub.auth.login.register")}
          </Link>
        </>
      }
    >
      {formError && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <GoogleSignIn redirectTo={target} />
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
          <form.Field name="password">
            {(field) => (
              <TextField field={field} label={t("pub.auth.password")} type="password" autoComplete="current-password" />
            )}
          </form.Field>
          <Link to="/forgot-password" className="-mt-4 self-end text-sm text-muted-foreground hover:text-primary hover:underline">
            {t("pub.auth.login.forgot")}
          </Link>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <SubmitButton pending={isSubmitting} icon={LogIn} size="lg">
                {t("pub.auth.login.submit")}
              </SubmitButton>
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
