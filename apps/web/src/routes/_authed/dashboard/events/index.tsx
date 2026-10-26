import { usePageTitle } from "@/hooks/use-page-title";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, CalendarPlus, ListFilter, Search, SearchX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { DataTable } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useT } from "@/i18n";
import { myEventsQueryOptions, statusInfo, type EventStatus } from "@/lib/events";
import { hasRole, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { NoEventsYet } from "../-components/no-events-yet";
import { useEventColumns } from "./-components/events-columns";

const statuses = ["draft", "public", "invite", "suspended"] as const;
const PAGE_SIZE = 10;

// filters live in the URL, so coming back from the editor lands on the same view
export const Route = createFileRoute("/_authed/dashboard/events/")({
  validateSearch: z.object({
    status: z.enum(statuses).optional(),
    q: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  component: EventsPage,
});

function EventsPage() {
  const t = useT();
  const { data: session } = useSession();
  const isAdmin = hasRole(session?.user, ["admin"]);
  usePageTitle(isAdmin ? t("dashboard.events.allTitle") : t("dashboard.events.ownTitle"));
  const navigate = Route.useNavigate();
  const { status, q = "", page = 1 } = Route.useSearch();
  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());

  useEffect(() => {
    if (debouncedSearch !== q) {
      void navigate({ search: (prev) => ({ ...prev, q: debouncedSearch || undefined, page: undefined }), replace: true });
    }
  }, [debouncedSearch, q, navigate]);

  const { data, isPending, isError, refetch, isPlaceholderData } = useQuery({
    ...myEventsQueryOptions({ page, pageSize: PAGE_SIZE, q: q || undefined, status }),
    placeholderData: keepPreviousData,
  });
  const columns = useEventColumns(isAdmin);
  const counts = data?.counts;
  const all = counts ? statuses.reduce((sum, s) => sum + counts[s], 0) : undefined;
  const filtered = !!status || !!q;

  const header = (
    <PageHeader
      icon={CalendarDays}
      title={isAdmin ? t("dashboard.events.allTitle") : t("dashboard.events.ownTitle")}
      description={t("dashboard.events.description")}
      actions={
        <Link to="/dashboard/events/new" className={buttonVariants()}>
          <CalendarPlus data-icon="inline-start" />
          {t("dashboard.events.create")}
        </Link>
      }
    />
  );

  // nothing created yet: one clear next step instead of an empty table with filters
  if (!isPending && all === 0 && !filtered) {
    return (
      <>
        {header}
        <Card>
          <CardContent>
            <NoEventsYet />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          variant="outline"
          className="flex-wrap"
          aria-label={t("dashboard.events.filterLabel")}
          value={[status ?? "all"]}
          onValueChange={(value: string[]) => {
            if (!value[0]) return;
            const next = value[0] === "all" ? undefined : (value[0] as EventStatus);
            void navigate({ search: (prev) => ({ ...prev, status: next, page: undefined }) });
          }}
        >
          <ToggleGroupItem value="all">
            <ListFilter />
            {t("dashboard.events.filterAll")}
            {all !== undefined && <span className="text-muted-foreground tabular-nums">{all}</span>}
          </ToggleGroupItem>
          {statuses
            // suspended only shows up when something is (or the filter is already on)
            .filter((s) => s !== "suspended" || (counts?.suspended ?? 0) > 0 || status === "suspended")
            .map((s) => {
              const { icon: Icon, label } = statusInfo[s];
              return (
                <ToggleGroupItem key={s} value={s}>
                  <Icon />
                  {label}
                  {counts && <span className="text-muted-foreground tabular-nums">{counts[s]}</span>}
                </ToggleGroupItem>
              );
            })}
        </ToggleGroup>
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            enterKeyHint="search"
            placeholder={t("dashboard.events.searchPlaceholder")}
            aria-label={t("dashboard.events.searchLabel")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label={t("dashboard.events.clearSearch")} onClick={() => setSearch("")}>
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      <div className={cn("transition-opacity", isPlaceholderData && "opacity-60")}>
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          mobileHide={["schedule"]}
          mobileFold={["status"]}
          error={isError && !data ? { onRetry: () => void refetch() } : undefined}
          isLoading={isPending}
          empty={{
            icon: SearchX,
            title: t("dashboard.events.emptyTitle"),
            description: q ? t("dashboard.events.emptySearch", { q }) : t("dashboard.events.emptyFilter"),
            action: filtered && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  void navigate({ search: {} });
                }}
              >
                <X data-icon="inline-start" />
                {t("dashboard.events.clearFilters")}
              </Button>
            ),
          }}
          pagination={{
            state: { pageIndex: page - 1, pageSize: PAGE_SIZE },
            onChange: ({ pageIndex }) =>
              void navigate({ search: (prev) => ({ ...prev, page: pageIndex > 0 ? pageIndex + 1 : undefined }) }),
            rowCount: data?.total ?? 0,
          }}
        />
      </div>
    </>
  );
}
