import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { auth } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { useT } from "@/i18n";
import { providersQueryOptions } from "@/lib/providers";

// lucide has no brand logos; a single-color mark keeps to the theme tokens
function GoogleIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M21.35 11.1h-9.17v2.92h5.25c-.23 1.4-1.64 4.1-5.25 4.1-3.16 0-5.74-2.62-5.74-5.85s2.58-5.85 5.74-5.85c1.8 0 3 .77 3.69 1.43l2.52-2.43C16.78 3.9 14.68 3 12.18 3 7.06 3 2.9 7.13 2.9 12.27s4.16 9.27 9.28 9.27c5.36 0 8.91-3.77 8.91-9.07 0-.61-.07-1.08-.15-1.37Z" />
    </svg>
  );
}

/** "Continue with Google" plus an "or" separator; renders nothing unless Google login is configured. */
export function GoogleSignIn({ redirectTo }: { redirectTo: string }) {
  const t = useT();
  const { data: providers } = useQuery(providersQueryOptions);
  const signIn = useMutation({
    mutationFn: async () => {
      const origin = window.location.origin;
      const { error } = await auth.signIn.social({
        provider: "google",
        callbackURL: origin + redirectTo,
        // OAuth failures (e.g. account_not_linked) come back to /login?error=...
        errorCallbackURL: `${origin}/login`,
      });
      if (error) throw error;
    },
    onError: (error) => toast.add({ type: "error", title: authErrorMessage(error) }),
  });

  if (!providers?.google) return null;

  // on success the browser leaves for Google, so the button stays pending
  const pending = signIn.isPending || signIn.isSuccess;
  return (
    <>
      <Button variant="outline" size="lg" disabled={pending} onClick={() => signIn.mutate()}>
        {pending ? <Spinner data-icon="inline-start" /> : <GoogleIcon data-icon="inline-start" />}
        {t("shared.google.continue")}
      </Button>
      <FieldSeparator>{t("shared.google.or")}</FieldSeparator>
    </>
  );
}
