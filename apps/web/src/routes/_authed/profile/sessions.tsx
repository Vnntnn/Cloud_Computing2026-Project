import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LogOut, Monitor, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useT, type Translate } from "@/i18n";
import { auth } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Section } from "./-components/section";
import { sessionsQueryOptions } from "./-components/queries";

export const Route = createFileRoute("/_authed/profile/sessions")({
  staticData: { title: "account.profile.layout.nav.sessions" },
  component: SessionsPage,
});

function SessionsPage() {
  const { data: session } = useSession();
  return <SessionsSection currentToken={session?.session.token} />;
}

function describeDevice(t: Translate, userAgent?: string | null) {
  if (!userAgent) return { label: t("account.profile.sessions.unknownDevice"), mobile: false };
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : t("account.profile.sessions.browser");
  const os =
    /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Android/.test(userAgent) ? "Android"
    : /Mac OS X/.test(userAgent) ? "macOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Linux/.test(userAgent) ? "Linux"
    : t("account.profile.sessions.unknownOs");
  return { label: t("account.profile.sessions.browserOn", { browser, os }), mobile: /Mobile|Android|iPhone/.test(userAgent) };
}

function SessionsSection({ currentToken }: { currentToken?: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: sessions, isPending } = useQuery(sessionsQueryOptions);

  const revoke = useMutation({
    mutationFn: async (token?: string) => {
      const { error } = token ? await auth.revokeSession({ token }) : await auth.revokeOtherSessions();
      if (error) throw error;
    },
    onSuccess: () => {
      toast.add({ type: "success", title: t("account.profile.sessions.revoked") });
      return queryClient.invalidateQueries({ queryKey: sessionsQueryOptions.queryKey });
    },
    onError: (error) => toast.add({ type: "error", title: authErrorMessage(error) }),
  });

  const others = sessions?.filter((item) => item.token !== currentToken) ?? [];
  const ordered = [...(sessions ?? [])].sort((a, b) => Number(b.token === currentToken) - Number(a.token === currentToken));

  return (
    <Section
      title={t("account.profile.sessions.title")}
      description={t("account.profile.sessions.description")}
    >
      {isPending ? (
        <Skeleton className="h-20" />
      ) : (
        <ul className="flex flex-col divide-y">
          {ordered.map((item) => {
            const device = describeDevice(t, item.userAgent);
            const DeviceIcon = device.mobile ? Smartphone : Monitor;
            const current = item.token === currentToken;
            return (
              <li key={item.id} className="flex flex-col items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <DeviceIcon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      {device.label}
                      {current && <Badge>{t("account.profile.sessions.thisDevice")}</Badge>}
                    </span>
                    <span className="text-sm text-muted-foreground sm:truncate">
                      {item.ipAddress ? `${item.ipAddress} · ` : ""}
                      {t("account.profile.sessions.signedInAt", { date: formatDateTime(item.createdAt) })}
                    </span>
                  </div>
                </div>
                {!current && (
                  <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(item.token)}>
                    <LogOut data-icon="inline-start" />
                    {t("account.profile.sessions.signOut")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 && (
        <Button variant="outline" className="self-start" disabled={revoke.isPending} onClick={() => revoke.mutate(undefined)}>
          {revoke.isPending ? <Spinner data-icon="inline-start" /> : <LogOut data-icon="inline-start" />}
          {t("account.profile.sessions.signOutOthers")}
        </Button>
      )}
    </Section>
  );
}
