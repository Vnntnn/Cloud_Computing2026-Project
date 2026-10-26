import FileHandler from "@tiptap/extension-file-handler";
import Image from "@tiptap/extension-image";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Check,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { formatNumber } from "@/lib/format";

type RichTextEditorProps = {
  /** HTML. Changing it from outside (a reset, a save) replaces the editor's content. */
  value: string;
  onChange: (html: string) => void;
  /** Uploads one image and returns the URL to embed. Throw an Error with a Thai message to report a failure. */
  onUploadImage: (file: File) => Promise<string>;
  /** Only images whose src starts with this survive a paste; the server drops any other image anyway. */
  allowedImagePrefix: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

/**
 * WYSIWYG editor (Tiptap) for event descriptions. Images can be picked, pasted or dropped;
 * they upload to the event's gallery and are embedded by URL. Output is HTML the server sanitizes.
 */
export function RichTextEditor({
  value,
  onChange,
  onUploadImage,
  allowedImagePrefix,
  placeholder,
  disabled,
  invalid,
}: RichTextEditorProps) {
  const t = useT();
  const placeholderText = placeholder ?? t("shared.richText.placeholder");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  // the HTML this editor last emitted, to tell outside changes from its own echo
  const lastHtml = useRef(value);
  // Tiptap serializes loaded HTML its own way; map that form back to the loaded string,
  // so the form only sees a change when the content really changed (an edit then undo is clean)
  const loaded = useRef({ raw: value, normalized: value });
  const callbacks = useRef({ onChange, onUploadImage });
  useEffect(() => {
    callbacks.current = { onChange, onUploadImage };
  });

  async function uploadImages(editor: Editor, files: File[], pos?: number) {
    const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
    if (images.length < files.length) toast.add({ type: "error", title: t("shared.richText.imageTypes") });
    setUploading((n) => n + images.length);
    // one at a time, so the images land in the order they were picked
    let at = pos;
    for (const file of images) {
      try {
        const src = await callbacks.current.onUploadImage(file);
        const image = { type: "image", attrs: { src, alt: file.name.replace(/\.[^.]+$/, "") } };
        if (at === undefined) {
          editor.chain().focus().insertContent(image).run();
        } else {
          // a drop inserts where it landed; the next image goes right after the previous one
          editor.chain().insertContentAt(at, image).run();
          at = editor.state.selection.to;
        }
      } catch (error) {
        toast.add({ type: "error", title: error instanceof Error ? error.message : t("shared.richText.uploadFailed") });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Image,
      Placeholder.configure({ placeholder: placeholderText }),
      CharacterCount,
      // uploadImages reads the latest onUploadImage from a ref when a file is dropped, never during render
      // oxlint-disable-next-line react/refs
      FileHandler.configure({
        allowedMimeTypes: IMAGE_TYPES,
        onDrop: (editor, files, pos) => void uploadImages(editor, files, pos),
        onPaste: (editor, files) => void uploadImages(editor, files),
      }),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: { "aria-label": t("shared.richText.ariaLabel"), class: "min-h-64 px-4 py-3 outline-none" },
      // images pasted from other sites would be dropped on save; drop them now so what you see is what's kept
      transformPastedHTML: (html) =>
        html.replace(/<img\b[^>]*>/gi, (tag) => (tag.includes(`src="${allowedImagePrefix}`) ? tag : "")),
    },
    onCreate: ({ editor }) => {
      loaded.current = { raw: loaded.current.raw, normalized: serialize(editor) };
    },
    onUpdate: ({ editor }) => {
      let html = serialize(editor);
      if (html === loaded.current.normalized) html = loaded.current.raw;
      lastHtml.current = html;
      callbacks.current.onChange(html);
    },
  });

  useEffect(() => {
    if (!editor || value === lastHtml.current) return;
    lastHtml.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
    loaded.current = { raw: value, normalized: serialize(editor) };
  }, [editor, value]);

  useEffect(() => {
    // false: toggling editability isn't an edit, so it must not emit an update
    if (editor && editor.isEditable === !!disabled) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      underline: editor?.isActive("underline") ?? false,
      strike: editor?.isActive("strike") ?? false,
      h2: editor?.isActive("heading", { level: 2 }) ?? false,
      h3: editor?.isActive("heading", { level: 3 }) ?? false,
      bullet: editor?.isActive("bulletList") ?? false,
      ordered: editor?.isActive("orderedList") ?? false,
      quote: editor?.isActive("blockquote") ?? false,
      link: editor?.isActive("link") ?? false,
      canUndo: editor?.can().undo() ?? false,
      canRedo: editor?.can().redo() ?? false,
      characters: editor?.storage.characterCount.characters() ?? 0,
    }),
  });

  if (!editor || !state) return null;
  const chain = () => editor.chain().focus();

  return (
    <div
      data-slot="rich-text-editor"
      aria-invalid={invalid}
      className="rounded-md border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 aria-invalid:border-destructive"
    >
      <TooltipProvider>
        {/* sticks under the 4.25rem navbar while a long description scrolls */}
        <div className="sticky top-17 z-10 flex flex-wrap items-center gap-1 rounded-t-md border-b bg-background p-1.5">
          <ToolbarToggle label={t("shared.richText.bold")} icon={Bold} shortcut={`${mod}B`} pressed={state.bold} disabled={disabled} onToggle={() => chain().toggleBold().run()} />
          <ToolbarToggle label={t("shared.richText.italic")} icon={Italic} shortcut={`${mod}I`} pressed={state.italic} disabled={disabled} onToggle={() => chain().toggleItalic().run()} />
          <ToolbarToggle label={t("shared.richText.underline")} icon={Underline} shortcut={`${mod}U`} pressed={state.underline} disabled={disabled} onToggle={() => chain().toggleUnderline().run()} />
          <ToolbarToggle label={t("shared.richText.strike")} icon={Strikethrough} pressed={state.strike} disabled={disabled} onToggle={() => chain().toggleStrike().run()} />
          <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-auto" />
          <ToolbarToggle label={t("shared.richText.h2")} icon={Heading2} pressed={state.h2} disabled={disabled} onToggle={() => chain().toggleHeading({ level: 2 }).run()} />
          <ToolbarToggle label={t("shared.richText.h3")} icon={Heading3} pressed={state.h3} disabled={disabled} onToggle={() => chain().toggleHeading({ level: 3 }).run()} />
          <ToolbarToggle label={t("shared.richText.bullet")} icon={List} pressed={state.bullet} disabled={disabled} onToggle={() => chain().toggleBulletList().run()} />
          <ToolbarToggle label={t("shared.richText.ordered")} icon={ListOrdered} pressed={state.ordered} disabled={disabled} onToggle={() => chain().toggleOrderedList().run()} />
          <ToolbarToggle label={t("shared.richText.quote")} icon={Quote} pressed={state.quote} disabled={disabled} onToggle={() => chain().toggleBlockquote().run()} />
          <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-auto" />
          <LinkButton editor={editor} active={state.link} disabled={disabled} />
          <ToolbarButton label={t("shared.richText.insertImage")} icon={ImagePlus} disabled={disabled} onClick={() => fileInput.current?.click()} />
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              void uploadImages(editor, Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-auto" />
          <ToolbarButton label={t("shared.richText.undo")} icon={Undo2} shortcut={`${mod}Z`} disabled={disabled || !state.canUndo} onClick={() => chain().undo().run()} />
          <ToolbarButton label={t("shared.richText.redo")} icon={Redo2} shortcut={isMac ? "⇧⌘Z" : "Ctrl+Y"} disabled={disabled || !state.canRedo} onClick={() => chain().redo().run()} />
          {uploading > 0 && (
            <span className="ml-auto flex items-center gap-2 px-2 text-sm text-muted-foreground" aria-live="polite">
              <Spinner />
              {t("shared.richText.uploading", { n: uploading })}
            </span>
          )}
        </div>
      </TooltipProvider>
      <EditorContent editor={editor} className="rich-text" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>{t("shared.richText.dropHint")}</span>
        <span className="tabular-nums">{t("shared.richText.characters", { n: formatNumber(state.characters) })}</span>
      </div>
    </div>
  );
}

type ToolbarItemProps = { label: string; icon: LucideIcon; shortcut?: string; disabled?: boolean };

function ToolbarTip({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <TooltipContent>
      {label}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </TooltipContent>
  );
}

/** A formatting mark or block that is on or off at the cursor. */
function ToolbarToggle({
  label,
  icon: Icon,
  shortcut,
  disabled,
  pressed,
  onToggle,
}: ToolbarItemProps & { pressed: boolean; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Toggle size="sm" aria-label={label} pressed={pressed} disabled={disabled} onPressedChange={onToggle} />}
      >
        <Icon />
      </TooltipTrigger>
      <ToolbarTip label={label} shortcut={shortcut} />
    </Tooltip>
  );
}

function ToolbarButton({ label, icon: Icon, shortcut, disabled, onClick }: ToolbarItemProps & { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} />}
      >
        <Icon />
      </TooltipTrigger>
      <ToolbarTip label={label} shortcut={shortcut} />
    </Tooltip>
  );
}

const serialize = (editor: Editor) => (editor.isEmpty ? "" : editor.getHTML());

const isUrl = (value: string) => /^(https?:\/\/\S+|mailto:\S+@\S+)$/i.test(value);

/** Toolbar button with a small popover to add, change or remove the link on the selection. */
function LinkButton({ editor, active, disabled }: { editor: Editor; active: boolean; disabled?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const invalid = url !== "" && !isUrl(url);

  const apply = () => {
    if (!url || invalid) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setOpen(false);
  };
  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setUrl((editor.getAttributes("link").href as string | undefined) ?? "https://");
        setOpen(next);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Toggle size="sm" aria-label={t("shared.richText.link")} pressed={active} disabled={disabled} />
              }
            />
          }
        >
          <LinkIcon />
        </TooltipTrigger>
        <TooltipContent>{t("shared.richText.link")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            // React submit events bubble through the portal into the page's own form
            e.stopPropagation();
            apply();
          }}
        >
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor="rich-text-link">
              <LinkIcon className="size-4 text-muted-foreground" />
              {t("shared.richText.link")}
            </FieldLabel>
            <Input
              id="rich-text-link"
              value={url}
              autoFocus
              aria-invalid={invalid}
              placeholder="https://example.com"
              onChange={(e) => setUrl(e.target.value.trim())}
            />
            <FieldDescription>{invalid ? t("shared.richText.linkInvalid") : t("shared.richText.linkHint")}</FieldDescription>
          </Field>
          <div className="flex justify-end gap-2">
            {active && (
              <Button type="button" variant="ghost" size="sm" onClick={remove}>
                <Unlink data-icon="inline-start" />
                {t("shared.richText.removeLink")}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!url || invalid}>
              <Check data-icon="inline-start" />
              {t("shared.richText.applyLink")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
