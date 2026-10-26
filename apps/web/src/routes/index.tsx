import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CalendarPlus, CalendarX, RotateCw, UserPlus } from "lucide-react";
import { HomeHero } from "@/components/home-hero";
import { Billboard, KindIndex, Ledger } from "@/components/home-events";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { categoriesQueryOptions } from "@/lib/events";
import { photoCredits } from "@/lib/credits";
import { hasRole, useSession } from "@/lib/session";
import { useUpcoming } from "@/lib/upcoming";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  const navigate = Route.useNavigate();
  const { data, rest, isError } = useUpcoming();
  // the hero's canopy edge is cut in the colour of whatever comes next: the Upcoming section's sand, or the index's page ground
  const upcomingShows = !(data && !isError && !rest?.length);
  return (
    // the page's own padding is cancelled so the hero, the index and the closing band run edge to edge
    <div className="-m-4 flex flex-col">
      <HomeHero edge={upcomingShows ? "sand" : "page"} onSearch={(q) => void navigate({ to: "/events", search: { q: q || undefined } })} />
      <Upcoming />
      <Kinds />
      <HostBand />
    </div>
  );
}

const sectionHeading = "rise-in text-4xl leading-[1.2] font-bold tracking-tight text-balance sm:text-5xl sm:leading-[1.2]";

/** The events after the hero's programme: the first one set big, the others in a ledger beside it. Nothing when the programme already shows them all. */
function Upcoming() {
  const t = useT();
  const { data, rest, isError, refetch, isRefetching } = useUpcoming();

  // nothing to add: no events at all (the hero says so), or all of them already fit in its programme
  if (data && !isError && !rest?.length) return null;

  const heading = (
    <div className="mb-10 flex items-end justify-between gap-4">
      <h2 id="upcoming-heading" className={sectionHeading}>
        {t("pub.home.upcoming.heading")}
      </h2>
      {!!data?.total && (
        <Link to="/events" className={buttonVariants({ variant: "ghost" })}>
          {t("pub.home.upcoming.viewAll")}
          <ArrowRight data-icon="inline-end" />
        </Link>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (isError)
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarX />
          </EmptyMedia>
          <EmptyTitle>{t("pub.home.upcoming.error.title")}</EmptyTitle>
          <EmptyDescription>{t("pub.home.upcoming.error.description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" disabled={isRefetching} onClick={() => void refetch()}>
            <RotateCw data-icon="inline-start" />
            {t("pub.home.upcoming.retry")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  else if (!rest)
    body = (
      <div aria-hidden className="flex flex-col gap-12 lg:gap-14">
        <div className="grid gap-6 lg:grid-cols-[7fr_5fr] lg:gap-12">
          <Skeleton className="aspect-[5/4] rounded-sm sm:aspect-[4/3] lg:aspect-[16/9]" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        </div>
        <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  else {
    const [lead, ...others] = rest;
    body = (
      <div className="flex flex-col gap-12 lg:gap-14">
        <Billboard event={lead} />
        {others.length > 0 && <Ledger events={others} />}
      </div>
    );
  }

  return (
    <section aria-labelledby="upcoming-heading" className="on-sand bg-sand text-sun-foreground dark:bg-dusk dark:text-dusk-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 pt-16 pb-20 sm:pt-24 sm:pb-28">
        {heading}
        {body}
      </div>
    </section>
  );
}

/** Ways into the events by kind: an index set in type, one row per category. */
function Kinds() {
  const t = useT();
  const { data: categories, isPending } = useQuery(categoriesQueryOptions);
  if (!isPending && !categories?.length) return null;

  return (
    <section aria-labelledby="kinds-heading" className="bg-background text-foreground dark:bg-dusk-mid dark:text-dusk-foreground">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:py-24">
        <h2 id="kinds-heading" className={`${sectionHeading} mb-10`}>
          {t("pub.home.categories")}
        </h2>
        {isPending ? (
          <div aria-hidden className="grid gap-x-12 lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="my-4 h-12 bg-current/10" />
            ))}
          </div>
        ) : (
          <KindIndex categories={categories ?? []} />
        )}
      </div>
    </section>
  );
}

const credits = [photoCredits.nebula, photoCredits.crowd];

/** Where hosting starts depends on who's looking: sign up, apply, or go straight to a new event. Ends the page on a photograph. */
function HostBand() {
  const t = useT();
  const note = t("pub.home.host.approvalNote");
  const { data: session, isPending } = useSession();
  const user = session?.user;

  return (
    <section aria-labelledby="host-heading" className="relative isolate overflow-hidden bg-dusk text-dusk-foreground">
      <img
        src="/art/crowd.webp"
        width={2200}
        height={1342}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 -z-10 size-full object-cover object-[50%_75%]"
      />
      <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-r from-dusk via-dusk/80 to-dusk/10 max-lg:to-dusk/55" />
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pt-24 pb-10 sm:pt-32 sm:pb-12">
        <div className="flex max-w-2xl flex-col gap-5">
          <h2 id="host-heading" className="text-4xl leading-snug font-bold tracking-tight text-balance sm:text-6xl sm:leading-snug">
            {t("pub.home.host.heading")}
          </h2>
          {isPending ? (
            <Skeleton className="h-6 w-80 max-w-full bg-dusk-foreground/15" />
          ) : (
            <p className="text-lg text-dusk-foreground/90 sm:text-xl">
              {!user
                ? t("pub.home.host.guest", { note })
                : hasRole(user, ["organizer", "admin"])
                  ? t("pub.home.host.organizer")
                  : t("pub.home.host.applicant", { note })}
            </p>
          )}
        </div>
        {isPending ? (
          <Skeleton className="h-12 w-44 shrink-0 rounded-4xl bg-dusk-foreground/15" />
        ) : !user ? (
          <Link to="/register" search={{ redirect: "/profile/organizer" }} className={buttonVariants({ variant: "sun", size: "xl", className: "w-fit" })}>
            <UserPlus data-icon="inline-start" />
            {t("pub.home.host.register")}
          </Link>
        ) : hasRole(user, ["organizer", "admin"]) ? (
          <Link to="/dashboard/events/new" className={buttonVariants({ variant: "sun", size: "xl", className: "w-fit" })}>
            <CalendarPlus data-icon="inline-start" />
            {t("pub.home.host.create")}
          </Link>
        ) : (
          <Link to="/profile/organizer" className={buttonVariants({ variant: "sun", size: "xl", className: "w-fit" })}>
            <CalendarPlus data-icon="inline-start" />
            {t("pub.home.host.apply")}
          </Link>
        )}
        <p className="mt-10 text-sm text-dusk-foreground/90">
          {t("pub.home.credits.label")} ({t("pub.home.credits.changes")}):{" "}
          {credits.map((c, i) => (
            <span key={c.who}>
              {i > 0 && " · "}
              <a href={c.href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-dusk-foreground">
                {c.who}
              </a>{" "}
              {c.licence}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
