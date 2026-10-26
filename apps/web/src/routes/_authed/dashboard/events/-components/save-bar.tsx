import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { CircleAlert, Save, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { LeaveGuard } from "@/components/leave-guard";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";

type SaveBarProps = {
  /** number of fields that differ from the saved event */
  changes: number;
  saving: boolean;
  disabled?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** set to true right before leaving on purpose (e.g. after a delete), so the guard lets it through */
  allowLeaveRef: React.RefObject<boolean>;
};

/** Floating save / discard bar while the form has unsaved changes. Mod+S saves; leaving the page asks first. */
export function SaveBar({ changes, saving, disabled, onSave, onDiscard, allowLeaveRef }: SaveBarProps) {
  const t = useT();
  const dirty = changes > 0;
  const latest = useRef({ dirty, saving, disabled, onSave });
  useEffect(() => {
    latest.current = { dirty, saving, disabled, onSave };
  });

  // registered even when clean, so Mod+S never opens the browser's "save page" dialog here
  useHotkey("Mod+S", () => {
    const { dirty, saving, disabled, onSave } = latest.current;
    if (dirty && !saving && !disabled) onSave();
  });

  return (
    <>
      {(dirty || saving) && (
        <div
          data-slot="save-bar"
          role="status"
          className="sticky bottom-4 z-20 mx-auto flex w-full max-w-2xl animate-in items-center gap-3 rounded-4xl border bg-background py-2 pr-2 pl-4 shadow-lg fade-in-0 slide-in-from-bottom-4"
        >
          <CircleAlert className="size-4 shrink-0 text-primary dark:text-chart-2" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {saving ? (
              t("dashboard.saveBar.saving")
            ) : (
              <>
                <span className="sm:hidden">{t("dashboard.saveBar.unsavedShort", { changes })}</span>
                <span className="hidden sm:inline">{t("dashboard.saveBar.unsaved", { changes })}</span>
              </>
            )}
          </span>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDiscard}>
            <Undo2 data-icon="inline-start" />
            {t("dashboard.saveBar.discard")}
          </Button>
          <Button type="button" size="sm" disabled={saving || disabled} onClick={onSave}>
            {saving ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {t("dashboard.saveBar.save")}
            <Kbd className="hidden bg-primary-foreground/20 text-primary-foreground sm:inline-flex">
              {formatForDisplay("Mod+S")}
            </Kbd>
          </Button>
        </div>
      )}
      <LeaveGuard
        when={dirty}
        allowLeaveRef={allowLeaveRef}
        description={t("dashboard.saveBar.leave", { changes })}
      />
    </>
  );
}
