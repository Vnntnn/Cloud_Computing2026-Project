import { InkScene } from "@/components/navbar";
import { useT } from "@/i18n";
import { photoCredits } from "@/lib/credits";
import { reveal } from "@/lib/reveal";

/**
 * The page shared by sign-in, sign-up and the password pages: the form on the page's own ground, beside (wide screens) or under
 * (phones) a panel of the ink scene with the market photograph and what Eventide is for.
 */
export function AuthLayout({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    // the page's own padding is cancelled so the panel runs to the edges
    <div data-slot="auth-layout" className="-m-4 grid min-h-[calc(100svh-4.25rem)] grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,1fr)_minmax(30rem,36rem)] lg:grid-rows-none">
      <InkScene />
      <aside className="relative isolate flex min-h-52 flex-col justify-end overflow-hidden bg-dusk text-dusk-foreground lg:min-h-0">
        <img src="/art/hero-market-1200.webp" srcSet="/art/hero-market-800.webp 800w, /art/hero-market-1200.webp 1200w, /art/hero-market.webp 1600w" sizes="(min-width: 1024px) 50vw, 100vw" width={1600} height={1323} alt="" decoding="async" className="absolute inset-0 -z-10 size-full object-cover object-[60%_35%] opacity-70" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-t from-dusk via-dusk/70 to-dusk/10 lg:bg-linear-to-r lg:from-dusk/10 lg:via-dusk/10 lg:to-dusk/60" />
        <div aria-hidden className="absolute inset-0 -z-10 hidden bg-linear-to-t from-dusk via-dusk/50 to-transparent lg:block" />
        {/* the navbar's ink carries on into the photograph instead of meeting a hard edge */}
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-28 bg-linear-to-b from-dusk to-transparent" />
        <div className="flex flex-col gap-3 p-6 pt-24 sm:p-8 lg:max-w-xl lg:gap-5 lg:p-14">
          <p className="text-[clamp(1.75rem,1rem+2.4vw,3.5rem)] leading-[1.25] font-bold tracking-tight">
            <span className="block">{t("pub.home.hero.titleLine1")}</span>
            <span className="block text-sun">{t("pub.home.hero.titleLine2")}</span>
          </p>
          <p className="hidden max-w-md text-lg text-dusk-foreground/85 lg:block">{t("pub.home.hero.subtitle")}</p>
          <p className="text-xs text-dusk-foreground/85 lg:mt-6">
            {t("pub.home.credits.label")} ({t("pub.home.credits.changes")}):{" "}
            <a href={photoCredits.market.href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-dusk-foreground">
              {photoCredits.market.who}
            </a>{" "}
            {photoCredits.market.licence}
          </p>
        </div>
      </aside>
      <div className="flex items-start justify-center px-4 py-10 sm:px-8 sm:py-14 lg:items-center lg:px-14">
        <div className="flex w-full max-w-md flex-col gap-8">
          <header className="reveal flex flex-col gap-2" style={reveal(60)}>
            <h1 className="text-3xl leading-[1.3] font-bold tracking-tight text-balance sm:text-4xl sm:leading-[1.3]">{title}</h1>
            <p className="text-base text-muted-foreground">{description}</p>
          </header>
          <div className="reveal flex flex-col gap-6" style={reveal(150)}>
            {children}
          </div>
          {footer && <p className="flex flex-wrap justify-center gap-1 text-sm text-muted-foreground">{footer}</p>}
        </div>
      </div>
    </div>
  );
}
