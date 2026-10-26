import { SiFacebook, SiLine, SiTelegram, SiWhatsapp, SiX } from "@icons-pack/react-simple-icons";
import { Check, Copy, Download, Info, Mail, QrCode, Share, Share2 } from "lucide-react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT, type MessageKey } from "@/i18n";

type ShareEventProps = {
  title: string;
  url: string;
  /** used for the downloaded QR file name */
  slug: string;
  /** why others can't open the link yet (draft, scheduled, suspended), if that's the case */
  notice?: string;
};

type Channel = {
  name: string;
  /** a translated name, for the networks that have no brand name */
  nameKey?: MessageKey;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean; title?: string }>;
  href: (url: string, title: string) => string;
};

const e = encodeURIComponent;

// Each network's own share endpoint; they open in a new tab, so nothing here needs an SDK or app id.
const channels: Channel[] = [
  { name: "Facebook", icon: SiFacebook, href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${e(url)}` },
  { name: "LINE", icon: SiLine, href: (url) => `https://social-plugins.line.me/lineit/share?url=${e(url)}` },
  { name: "X", icon: SiX, href: (url, title) => `https://x.com/intent/post?text=${e(title)}&url=${e(url)}` },
  { name: "WhatsApp", icon: SiWhatsapp, href: (url, title) => `https://wa.me/?text=${e(`${title} ${url}`)}` },
  { name: "Telegram", icon: SiTelegram, href: (url, title) => `https://t.me/share/url?url=${e(url)}&text=${e(title)}` },
  { name: "Email", nameKey: "shared.share.email", icon: Mail, href: (url, title) => `mailto:?subject=${e(title)}&body=${e(`${title}\n${url}`)}` },
];

/** Copies `text`, and reports "copied" for two seconds so the button can show a check. */
function useCopy() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.add({ type: "success", title: t("shared.share.copied") });
    } catch {
      toast.add({ type: "error", title: t("shared.share.copyFailed"), description: t("shared.share.copyFailedHint") });
    }
  };
  return { copied, copy };
}

/** Share card for the event page: social networks, the system share sheet, copy link and a QR code. */
export function ShareEvent({ title, url, slug, notice }: ShareEventProps) {
  const t = useT();
  const { copied, copy } = useCopy();
  const [qrOpen, setQrOpen] = useState(false);
  // the system share sheet (phones, Safari, Edge); desktop Chrome and Firefox mostly lack it
  const canShareNatively = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function shareNatively() {
    try {
      await navigator.share({ title, text: title, url });
    } catch (error) {
      // closing the sheet is not an error worth reporting
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.add({ type: "error", title: t("shared.share.shareFailed") });
      }
    }
  }

  return (
    <Card data-slot="share-event">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="size-5 text-primary dark:text-chart-2" />
          {t("shared.share.title")}
        </CardTitle>
        <CardDescription>{t("shared.share.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {notice && (
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            {notice}
          </p>
        )}

        <TooltipProvider>
          <ul className="flex flex-wrap gap-2" aria-label={t("shared.share.shareTo")}>
            {channels.map(({ name, nameKey, icon: Icon, href }) => (
              <li key={name}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <a
                        href={href(url, title)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("shared.share.shareToChannel", { name: nameKey ? t(nameKey) : name })}
                        className={buttonVariants({ variant: "outline", size: "icon" })}
                      />
                    }
                  >
                    <Icon aria-hidden title="" />
                  </TooltipTrigger>
                  <TooltipContent>{nameKey ? t(nameKey) : name}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </TooltipProvider>

        <InputGroup>
          <InputGroupInput
            readOnly
            value={url}
            aria-label={t("shared.share.linkLabel")}
            onFocus={(e) => e.currentTarget.select()}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="xs" className="max-sm:h-8 max-sm:px-3" onClick={() => copy(url)}>
              {copied ? <Check /> : <Copy />}
              {copied ? t("shared.share.copiedShort") : t("shared.share.copy")}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => setQrOpen(true)}>
            <QrCode data-icon="inline-start" />
            {t("shared.share.qrCode")}
          </Button>
          {canShareNatively && (
            <Button type="button" variant="outline" className="flex-1" onClick={shareNatively}>
              <Share data-icon="inline-start" />
              {t("shared.share.native")}
            </Button>
          )}
        </div>
      </CardContent>

      <QrDialog open={qrOpen} onOpenChange={setQrOpen} title={title} url={url} slug={slug} notice={notice} />
    </Card>
  );
}

// dark modules on a white quiet zone whatever the theme: scanners need the contrast
const QR = { level: "M", fgColor: "#0a0a0a", bgColor: "#ffffff" } as const;

function QrDialog({
  open,
  onOpenChange,
  title,
  url,
  slug,
  notice,
}: ShareEventProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { copied, copy } = useCopy();
  const printable = useRef<HTMLCanvasElement>(null);

  function download() {
    const canvas = printable.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `eventide-${slug}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5" />
            {t("shared.share.qrTitle")}
          </DialogTitle>
          <DialogDescription>{t("shared.share.qrDescription")}</DialogDescription>
        </DialogHeader>
        <figure className="flex flex-col items-center gap-3">
          <div className="overflow-hidden rounded-md border">
            <QRCodeSVG value={url} size={232} marginSize={2} title={t("shared.share.qrOf", { title })} {...QR} />
          </div>
          <figcaption className="flex flex-col items-center gap-0.5 text-center">
            <span className="font-medium text-balance">{title}</span>
            <span className="text-xs break-all text-muted-foreground">{url}</span>
          </figcaption>
        </figure>
        {notice && <p className="text-center text-xs text-muted-foreground">{notice}</p>}
        {/* print size for the download; never shown */}
        <QRCodeCanvas ref={printable} value={url} size={1024} marginSize={4} className="hidden" {...QR} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => copy(url)}>
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? t("shared.share.copiedShort") : t("shared.share.copyLink")}
          </Button>
          <Button type="button" onClick={download}>
            <Download data-icon="inline-start" />
            {t("shared.share.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
