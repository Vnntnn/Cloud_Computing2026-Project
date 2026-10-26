import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { CalendarDays, CalendarX, ChevronLeft, ChevronRight, History, RotateCw, Search, SearchX, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePageTitle } from "@/hooks/use-page-title";
import { useT } from "@/i18n";
import { EventCard } from "@/components/event-card";
import { Billboard } from "@/components/home-events";
import { CategoryChip } from "@/components/event-poster";
import { PageHeader } from "@/components/page-header";
import { UserAvatar } from "@/components/user-avatar";
import { categoriesQueryOptions, publicEventsQueryOptions, type EventSummary } from "@/lib/events";
import { formatMonthYear } from "@/lib/format";
import { organizerQueryOptions } from "@/lib/organizers";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

// Pathless layout for /events and /events/categories/$category: the page lives here, so switching
// category keeps it mounted (search box, focus, previous results) instead of swapping route components.
export const Route = createFileRoute("/events/_browse")({
  validateSearch: z.object({
    q: z.string().optional(),
    organizer: z.uuid().optional(),
    when: z.enum(["upcoming", "past"]).optional(),
    page: z.number().int().min(1).optional(),
  }),
  component: EventsListPage,
});

function EventsListPage() {
  const t = useT();
  // `to: "."` keeps the current path; navigating from this layout would resolve "." to /events and drop the category
  const navigate = useNavigate();
  const { category: slug } = useParams({ strict: false });
  const { q = "", organizer, when = "upcoming", page = 1 } = Route.useSearch();
  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());

  useEffect(() => {
    if (debouncedSearch !== q) {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, q: debouncedSearch || undefined, page: undefined }),
        replace: true,
      });
    }
  }, [debouncedSearch, q, navigate]);

  const { data: categories, isError: categoriesError } = useQuery(categoriesQueryOptions);
  const category = slug ? categories?.find((c) => c.slug === slug) : undefined;
  const categoryMissing = !!slug && !!categories && !category;
  // a category path keeps its title until the categories load
  usePageTitle(slug ? category?.name : t("pub.browse.title"));
  const { data, isError, isPlaceholderData, refetch, isRefetching } = useQuery({
    ...publicEventsQueryOptions({
      page,
      pageSize: PAGE_SIZE,
      q: q || undefined,
      categoryId: category?.id,
      organizerId: organizer,
      when,
    }),
    // the API filters by id, so a category path waits for the slug to resolve
    enabled: !slug || !!category,
    placeholderData: keepPreviousData,
  });
  const pageCount = Math.max(Math.ceil((data?.total ?? 0) / PAGE_SIZE), 1);
  const filtered = !!q || !!slug || !!organizer;
  const goToPage = (next: number) => {
    void navigate({ to: ".", search: (prev) => ({ ...prev, page: next > 1 ? next : undefined }) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const selectCategory = (id: string) => {
    const next = categories?.find((c) => c.id === id);
    if (next) {
      void navigate({
        to: "/events/categories/$category",
        params: { category: next.slug },
        search: (prev) => ({ ...prev, page: undefined }),
      });
    } else {
      void navigate({ to: "/events", search: (prev) => ({ ...prev, page: undefined }) });
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 py-6">
      <PageHeader size="lg" title={category?.name ?? t("pub.browse.title")} description={t("pub.browse.subtitle")} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* a phone gives the search its own row: next to the Upcoming/Past toggle it was squeezed to a few pixels */}
          <InputGroup className="w-full sm:max-w-md sm:flex-1 sm:basis-0">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              enterKeyHint="search"
              placeholder={t("pub.browse.searchPlaceholder")}
              aria-label={t("pub.browse.searchLabel")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label={t("pub.browse.clearSearch")} onClick={() => setSearch("")}>
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          <ToggleGroup
            variant="outline"
            aria-label={t("pub.browse.whenLabel")}
            value={[when]}
            onValueChange={(value: string[]) =>
              value[0] &&
              void navigate({
                to: ".",
                search: (prev) => ({ ...prev, when: value[0] === "past" ? "past" : undefined, page: undefined }),
              })
            }
          >
            <ToggleGroupItem value="upcoming">
              <CalendarDays />
              {t("pub.browse.upcoming")}
            </ToggleGroupItem>
            <ToggleGroupItem value="past">
              <History />
              {t("pub.browse.past")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {organizer && (
          <OrganizerFilter
            organizerId={organizer}
            onClear={() =>
              void navigate({ to: ".", search: (prev) => ({ ...prev, organizer: undefined, page: undefined }) })
            }
          />
        )}
        {!!categories?.length && (
          <ToggleGroup
            variant="outline"
            size="sm"
            className="flex-wrap"
            aria-label={t("pub.browse.categoryLabel")}
            value={category ? [category.id] : slug ? [] : ["all"]}
            onValueChange={(value: string[]) => value[0] && selectCategory(value[0])}
          >
            <ToggleGroupItem value="all">
              <Tag />
              {t("pub.browse.allCategories")}
            </ToggleGroupItem>
            {categories.map((c) => (
              <ToggleGroupItem key={c.id} value={c.id}>
                <CategoryChip slug={c.slug} className="size-3.5" />
                {c.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {data && !isError && (
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-sm font-medium text-muted-foreground">
            {t("pub.browse.results", { n: data.total })}
          </p>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                void navigate({ to: "/events", search: (prev) => ({ when: prev.when }) });
              }}
            >
              <X data-icon="inline-start" />
              {t("pub.browse.empty.clearFilters")}
            </Button>
          )}
        </div>
      )}

      {isError || (slug && categoriesError) ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarX />
            </EmptyMedia>
            <EmptyTitle>{t("pub.browse.error.title")}</EmptyTitle>
            <EmptyDescription>{t("pub.browse.error.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" disabled={isRefetching} onClick={() => void refetch()}>
              <RotateCw data-icon="inline-start" />
              {t("shared.dataTable.retry")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : categoryMissing ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>{t("pub.browse.categoryMissing.title")}</EmptyTitle>
            <EmptyDescription>{t("pub.browse.categoryMissing.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link
              to="/events"
              search={(prev) => ({ ...prev, page: undefined })}
              className={buttonVariants({ variant: "outline" })}
            >
              <Tag data-icon="inline-start" />
              {t("pub.browse.categoryMissing.viewAll")}
            </Link>
          </EmptyContent>
        </Empty>
      ) : !data ? (
        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-4">
              <Skeleton className="aspect-[16/10] rounded-sm" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarX />
            </EmptyMedia>
            <EmptyTitle>{when === "past" ? t("pub.browse.empty.titlePast") : t("pub.browse.empty.titleUpcoming")}</EmptyTitle>
            <EmptyDescription>{filtered ? t("pub.browse.empty.descriptionFiltered") : t("pub.browse.empty.description")}</EmptyDescription>
          </EmptyHeader>
          {filtered && (
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  void navigate({ to: "/events", search: (prev) => ({ when: prev.when }) });
                }}
              >
                <X data-icon="inline-start" />
                {t("pub.browse.empty.clearFilters")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <Programme events={data.items} fading={isPlaceholderData} />
      )}

      {pageCount > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label={t("pub.browse.pagination.label")}>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            <ChevronLeft data-icon="inline-start" />
            {t("pub.browse.pagination.previous")}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("pub.browse.pagination.page", { page, pageCount })}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>
            {t("pub.browse.pagination.next")}
            <ChevronRight data-icon="inline-end" />
          </Button>
        </nav>
      )}
    </div>
  );
}

/**
 * The events as a programme: the first one set big (the way the home page sets its next event) when there are enough to
 * make a list, then the rest under the month they fall in, each month a heading in type with a card grid beneath it.
 * The server's order is kept; a month heading appears whenever the month changes.
 */
function Programme({ events, fading }: { events: EventSummary[]; fading: boolean }) {
  const lead = events.length >= 4 ? events[0] : undefined;
  const months: { key: string; at: string; items: EventSummary[] }[] = [];
  for (const event of lead ? events.slice(1) : events) {
    const d = new Date(event.startsAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const last = months.at(-1);
    if (last?.key === key) last.items.push(event);
    else months.push({ key, at: event.startsAt, items: [event] });
  }
  return (
    <div className={cn("flex flex-col gap-14 transition-opacity", fading && "opacity-60")}>
      {lead && <Billboard event={lead} level={2} />}
      {months.map((month) => (
        <section key={month.key} aria-labelledby={`month-${month.key}`} className="flex flex-col gap-8">
          <h2 id={`month-${month.key}`} className="rise-in border-t border-foreground/80 pt-4 text-3xl leading-[1.25] font-bold tracking-tight sm:text-4xl sm:leading-[1.25]">
            {formatMonthYear(month.at)}
          </h2>
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {month.items.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** "Events by …" chip shown while the list is narrowed to one organizer (from an event page's organizer section). */
function OrganizerFilter({ organizerId, onClear }: { organizerId: string; onClear: () => void }) {
  const t = useT();
  const { data: organizer } = useQuery(organizerQueryOptions(organizerId));
  // the name goes in bold wherever the language puts it
  const [before, after] = t("pub.browse.organizerFilter.prefix", { name: "\u0001" }).split("\u0001");
  return (
    <div className="flex items-center gap-2 self-start rounded-full border py-1 pr-1 pl-1.5 text-sm">
      {organizer ? <UserAvatar user={organizer} size="sm" /> : <Skeleton className="size-6 rounded-full" />}
      <span>
        {before}
        <span className="font-medium">{organizer?.name ?? t("pub.browse.organizerFilter.fallbackName")}</span>
        {after}
      </span>
      <Button variant="ghost" size="icon-xs" aria-label={t("pub.browse.organizerFilter.clear")} onClick={onClear}>
        <X />
      </Button>
    </div>
  );
}
