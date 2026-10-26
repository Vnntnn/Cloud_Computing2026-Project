import { ImageUp, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;

type CoverImageFieldProps = {
  imageUrl: string | null;
  /** resolves once stored; throw (with a translated message) to report a failure */
  onUpload: (file: File) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  disabled?: boolean;
};

/**
 * 16:9 cover: drop or pick an image. The picked file previews right away while it uploads,
 * so the change is visible before the server answers.
 */
export function CoverImageField({ imageUrl, onUpload, onRemove, disabled }: CoverImageFieldProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function upload(file: File | undefined) {
    if (!file || busy) return;
    if (!ACCEPTED_TYPES.includes(file.type)) return void toast.add({ type: "error", title: t("shared.coverImage.unsupportedType") });
    if (file.size > MAX_SIZE) return void toast.add({ type: "error", title: t("shared.coverImage.tooLarge") });
    setPreview(URL.createObjectURL(file));
    setBusy("upload");
    try {
      await onUpload(file);
      toast.add({ type: "success", title: t("shared.coverImage.uploaded") });
    } catch (error) {
      toast.add({ type: "error", title: error instanceof Error ? error.message : t("shared.coverImage.uploadFailed") });
    } finally {
      setPreview(null);
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      await onRemove();
      toast.add({ type: "success", title: t("shared.coverImage.removed") });
    } catch (error) {
      toast.add({ type: "error", title: error instanceof Error ? error.message : t("shared.coverImage.removeFailed") });
    } finally {
      setBusy(null);
    }
  }

  const shown = preview ?? imageUrl;
  const locked = disabled || !!busy;

  return (
    <div data-slot="cover-image-field" className="flex flex-col gap-3">
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={locked}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!locked) void upload(e.dataTransfer.files[0]);
        }}
        aria-label={shown ? t("shared.coverImage.changeAria") : t("shared.coverImage.uploadAria")}
        className={cn(
          "group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border-2 border-dashed bg-muted/50 text-muted-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:hover:border-primary/50 enabled:hover:bg-muted disabled:cursor-not-allowed",
          shown && "border-solid",
          dragging && "border-primary bg-primary/5",
        )}
      >
        {shown ? (
          <>
            <img src={shown} alt="" className="absolute inset-0 size-full object-cover" />
            {busy === "upload" ? (
              <span className="relative flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-sm text-foreground">
                <Spinner />
                {t("shared.coverImage.uploading")}
              </span>
            ) : (
              !disabled && (
                <span className="relative flex items-center gap-2 rounded-full bg-background/90 px-3 py-1.5 text-sm text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <RefreshCw className="size-4" />
                  {t("shared.coverImage.clickToChange")}
                </span>
              )
            )}
          </>
        ) : (
          <span className="flex flex-col items-center gap-2 p-4 text-center text-sm">
            <ImageUp className="size-8" />
            <span className="font-medium text-foreground">{t("shared.coverImage.dropOrPick")}</span>
            <span>{t("shared.coverImage.hint")}</span>
          </span>
        )}
      </button>
      {imageUrl && !disabled && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => input.current?.click()}>
            <RefreshCw data-icon="inline-start" />
            {t("shared.coverImage.change")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={remove}>
            {busy === "remove" ? <Spinner data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
            {t("shared.coverImage.remove")}
          </Button>
        </div>
      )}
    </div>
  );
}
