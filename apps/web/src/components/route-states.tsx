import { usePageTitle } from "@/hooks/use-page-title";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { Compass, Home, RotateCw, TriangleAlert } from "lucide-react";
import { InkScene } from "@/components/navbar";
import { Tide } from "@/components/event-poster";
import { Button, buttonVariants } from "@/components/ui/button";
import { useT } from "@/i18n";
import { reveal } from "@/lib/reveal";

/**
 * A full-height page in the ink scene for something that can't be shown: a plain statement, a way on, and optionally a large mark
 * (the 404, set the way the date is on a poster). The home page's ink, so a dead end still looks like Eventide.
 */
export function NoticeScene({ mark, title, description, children }: { mark?: string; title: string; description: string; children: React.ReactNode }) {
  return (
    // the page's own padding is cancelled so the ink runs edge to edge
    <section className="relative isolate -m-4 flex min-h-[calc(100svh-4.25rem)] flex-col justify-center overflow-hidden bg-dusk text-dusk-foreground">
      <InkScene />
      <Tide color="var(--sun)" className="top-auto bottom-0 -z-10 h-1/2 opacity-30" />
      {mark && (
        <span aria-hidden className="absolute -right-[4vw] -bottom-[8vw] -z-10 text-[min(48vw,30rem)] leading-[0.78] font-bold tracking-tighter text-sun tabular-nums">
          {mark}
        </span>
      )}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-16">
        <div className="reveal flex max-w-xl flex-col gap-4" style={reveal(60)}>
          <h1 className="text-[clamp(2.5rem,1rem+5vw,5rem)] leading-[1.2] font-bold tracking-tight text-balance">{title}</h1>
          <p className="text-lg text-dusk-foreground/85">{description}</p>
        </div>
        <div className="flex flex-wrap gap-3">{children}</div>
      </div>
    </section>
  );
}

/** The ways on from a dead end: back to the home page, or to the events. */
export function WaysOn() {
  const t = useT();
  return (
    <>
      <Link to="/" className={buttonVariants({ variant: "sun", size: "xl" })}>
        <Home data-icon="inline-start" />
        {t("pub.notFound.home")}
      </Link>
      <Link to="/events" className={buttonVariants({ variant: "inkOutline", size: "xl" })}>
        <Compass data-icon="inline-start" />
        {t("pub.notFound.explore")}
      </Link>
    </>
  );
}

/** The page for an address that goes nowhere. */
export function NotFound({ title, description }: { title?: string; description?: string } = {}) {
  const t = useT();
  usePageTitle(title ?? t("pub.notFound.title"));
  return (
    <NoticeScene mark="404" title={title ?? t("pub.notFound.title")} description={description ?? t("pub.notFound.description")}>
      <WaysOn />
    </NoticeScene>
  );
}

/** What a route shows when it throws: plain words and a way back, with the message only while developing. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const t = useT();
  usePageTitle(t("pub.routeError.title"));
  return (
    <section className="mx-auto flex min-h-[60svh] w-full max-w-xl flex-col justify-center gap-6 py-16">
      <h1 className="flex items-start gap-3 text-3xl leading-[1.3] font-bold tracking-tight text-balance sm:text-4xl sm:leading-[1.3]">
        <TriangleAlert className="mt-1.5 size-7 shrink-0 text-destructive sm:mt-2 sm:size-8" />
        {t("pub.routeError.title")}
      </h1>
      <p className="text-base text-muted-foreground">{t("pub.routeError.description")}</p>
      {import.meta.env.DEV && <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{error instanceof Error ? error.message : String(error)}</pre>}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={() => reset()}>
          <RotateCw data-icon="inline-start" />
          {t("pub.routeError.retry")}
        </Button>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
          <Home data-icon="inline-start" />
          {t("pub.routeError.home")}
        </Link>
      </div>
    </section>
  );
}
