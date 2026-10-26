import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert, UserPlus } from "lucide-react";
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

export const Route = createFileRoute("/register")({
  staticData: { title: "pub.auth.register.title" },
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: ({ context, search }) => redirectIfSignedIn(context.queryClient, search.redirect),
  component: RegisterPage,
});

// Better Auth's default password policy is 8 to 128 characters
const registerSchema = z
  .object({
    name: z.string().trim().min(2, { error: () => t("pub.auth.errors.nameMin") }).max(100, { error: () => t("pub.auth.errors.nameMax") }),
    email: z.email({ error: () => t("pub.auth.errors.email") }),
    password: z.string().min(8, { error: () => t("pub.auth.errors.passwordMin") }).max(128, { error: () => t("pub.auth.errors.passwordMax") }),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    error: () => t("pub.auth.errors.passwordMismatch"),
    path: ["confirmPassword"],
  });

function RegisterPage() {
  const t = useT();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const target = safeRedirect(search.redirect);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    validators: { onSubmit: registerSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const { error } = await auth.signUp.email({
        name: value.name.trim(),
        email: value.email,
        password: value.password,
      });
      if (error) return setFormError(authErrorMessage(error));
      await refreshSession(queryClient);
      await navigate({ href: target });
    },
  });

  return (
    <AuthLayout
      title={t("pub.auth.register.title")}
      description={t("pub.auth.register.description")}
      footer={
        <>
          {t("pub.auth.register.haveAccount")}
          <Link to="/login" search={{ redirect: search.redirect }} className="font-medium text-primary dark:text-chart-2 hover:underline">
            {t("pub.auth.register.login")}
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
          <form.Field name="name">
            {(field) => <TextField field={field} label={t("pub.auth.register.name")} autoComplete="name" />}
          </form.Field>
          <form.Field name="email">
            {(field) => (
              <TextField field={field} label={t("pub.auth.email")} type="email" autoComplete="email" placeholder="you@example.com" />
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <TextField
                field={field}
                label={t("pub.auth.password")}
                type="password"
                autoComplete="new-password"
                description={t("pub.auth.passwordHint")}
              />
            )}
          </form.Field>
          <form.Field name="confirmPassword">
            {(field) => (
              <TextField field={field} label={t("pub.auth.register.confirmPassword")} type="password" autoComplete="new-password" />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <SubmitButton pending={isSubmitting} icon={UserPlus} size="lg">
                {t("pub.auth.register.submit")}
              </SubmitButton>
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
