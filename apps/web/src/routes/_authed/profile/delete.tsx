import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { auth } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { useSession } from "@/lib/session";
import { Section } from "./-components/section";
import { accountsQueryOptions } from "./-components/queries";

export const Route = createFileRoute("/_authed/profile/delete")({
  staticData: { title: "account.profile.layout.nav.delete" },
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  const guarded = Route.useRouteContext().session;
  const { data: session } = useSession();
  const { data: accounts } = useQuery(accountsQueryOptions);
  const hasPassword = Boolean(accounts?.some((account) => account.providerId === "credential"));
  return <DeleteAccountSection hasPassword={hasPassword} isAdmin={(session?.user ?? guarded.user).role === "admin"} />;
}

function DeleteAccountSection({ hasPassword, isAdmin }: { hasPassword: boolean; isAdmin: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await auth.deleteUser(hasPassword ? { password } : {});
      if (error) throw error;
    },
    onSuccess: () => {
      // the session is gone server-side; a hard navigation drops every cached query
      window.location.assign("/");
    },
    onError: (error) => toast.add({ type: "error", title: authErrorMessage(error) }),
  });

  return (
    <Section
      tone="destructive"
      title={t("account.profile.delete.title")}
      description={
        isAdmin ? t("account.profile.delete.adminDescription") : t("account.profile.delete.description")
      }
    >
      <Button variant="destructive" className="self-start" disabled={isAdmin} onClick={() => setOpen(true)}>
        <Trash2 data-icon="inline-start" />
        {t("account.profile.delete.button")}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPassword("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("account.profile.delete.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("account.profile.delete.confirmIntro")}
              {hasPassword ? t("account.profile.delete.withPassword") : t("account.profile.delete.withoutPassword")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {hasPassword && (
            <Input
              type="password"
              value={password}
              autoComplete="current-password"
              placeholder={t("account.profile.delete.currentPassword")}
              aria-label={t("account.profile.delete.currentPassword")}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("account.profile.delete.cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending || (hasPassword && !password)}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
              {t("account.profile.delete.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
