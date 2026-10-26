import { useBlocker } from "@tanstack/react-router";
import { ArrowLeft, CircleAlert, LogOut } from "lucide-react";
import { useEffect, useRef } from "react";
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
import { useT } from "@/i18n";

type LeaveGuardProps = {
  /** block leaving while true (unsaved input) */
  when: boolean;
  /** set to true right before leaving on purpose (after a save or delete), so the guard lets it through */
  allowLeaveRef?: React.RefObject<boolean>;
  title?: string;
  description?: string;
};

/** Asks before leaving a page with unsaved input: in-app navigation gets a dialog, closing the tab the browser's prompt. */
export function LeaveGuard({
  when,
  allowLeaveRef,
  title,
  description,
}: LeaveGuardProps) {
  const t = useT();
  const whenRef = useRef(when);
  useEffect(() => {
    whenRef.current = when;
  }, [when]);
  const shouldBlock = () => whenRef.current && !allowLeaveRef?.current;
  const blocker = useBlocker({ shouldBlockFn: shouldBlock, enableBeforeUnload: shouldBlock, withResolver: true });

  return (
    <AlertDialog open={blocker.status === "blocked"} onOpenChange={(open) => !open && blocker.reset?.()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-primary/10 text-primary dark:text-chart-2">
            <CircleAlert />
          </AlertDialogMedia>
          <AlertDialogTitle>{title ?? t("shared.leaveGuard.title")}</AlertDialogTitle>
          <AlertDialogDescription>{description ?? t("shared.leaveGuard.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>
            <ArrowLeft data-icon="inline-start" />
            {t("shared.leaveGuard.stay")}
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
            <LogOut data-icon="inline-start" />
            {t("shared.leaveGuard.leave")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
