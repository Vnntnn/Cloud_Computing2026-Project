import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageUp, Trash2 } from "lucide-react";
import { useRef } from "react";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-client";
import { useT } from "@/i18n";
import { problemMessage } from "@/lib/auth-errors";
import { refreshSession } from "@/lib/session";

// Mirrors the avatar kind in @app/storage, for a quick answer; the server checks the bytes again.
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024;

export function AvatarPicker({ user }: { user: SessionUser }) {
  const t = useT();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);

  const done = async (title: string) => {
    await refreshSession(queryClient);
    toast.add({ type: "success", title });
  };
  const failed = (error: unknown) => toast.add({ type: "error", title: problemMessage(error) });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { error } = await authClient.api.auth.me.avatar.put({ file });
      if (error) throw error;
    },
    onSuccess: () => done(t("account.profile.avatar.changed")),
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.api.auth.me.avatar.delete();
      if (error) throw error;
    },
    onSuccess: () => done(t("account.profile.avatar.removed")),
    onError: failed,
  });

  const pending = upload.isPending || remove.isPending;

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // reset so choosing the same file again still fires onChange
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return void toast.add({ type: "error", title: t("account.profile.avatar.badType") });
    }
    if (file.size > MAX_SIZE) {
      return void toast.add({ type: "error", title: t("account.profile.avatar.tooLarge") });
    }
    upload.mutate(file);
  }

  const openPicker = () => input.current?.click();
  const trigger = (
    <button
      type="button"
      aria-label={t("account.profile.avatar.change")}
      disabled={pending}
      onClick={user.image ? undefined : openPicker}
      className="group/avatar relative block shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait"
    />
  );
  const overlay = (
    <>
      {/* `!`: cn only joins classes, so a plain size-16 lost to the avatar's own lg size and the corner badge covered the initials */}
      <UserAvatar user={user} size="lg" className="size-16! text-xl! dark:ring-1 dark:ring-foreground/20" />
      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/50 text-background opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
        {pending ? <Spinner /> : <Camera />}
      </span>
      <span
        aria-hidden
        className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border bg-background text-foreground shadow-sm [&_svg]:size-3.5"
      >
        {pending ? <Spinner /> : <Camera />}
      </span>
    </>
  );

  return (
    <div data-slot="avatar-picker" className="shrink-0">
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={pick}
      />
      {user.image ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={trigger} disabled={pending}>
            {overlay}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={openPicker}>
              <ImageUp />
              {t("account.profile.avatar.changePhoto")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => remove.mutate()}>
              <Trash2 />
              {t("account.profile.avatar.removePhoto")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <button
          type="button"
          aria-label={t("account.profile.avatar.upload")}
          disabled={pending}
          onClick={openPicker}
          className="group/avatar relative block rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait"
        >
          {overlay}
        </button>
      )}
    </div>
  );
}
