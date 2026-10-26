import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ListFilter, Search, SearchX, Ticket, TicketPlus, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { DataTable } from "@/components/data-table/data-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useT } from "@/i18n";
import { enrollmentStatusInfo, eventEnrollmentsQueryOptions, type EnrollmentStatus } from "@/lib/enrollments";
import { hasRole, useSession } from "@/lib/session";
import { ticketTypesQueryOptions } from "@/lib/ticket-types";
import { cn } from "@/lib/utils";
import { enrollmentColumns } from "./-components/enrollments-columns";
import { useEventDetail } from "./-components/use-event-detail";

const PAGE_SIZE = 10;
const STATUSES = ["pending", "awaiting_payment", "confirmed", "rejected", "expired", "cancelled"] as const;
const ALL_TYPES = "all";

// filters live in the URL, like the invitations tab
export const Route = createFileRoute("/_authed/dashboard/events/$eventId/participants")({
  validateSearch: z.object({
    status: z.enum(STATUSES).optional(),
    ticketTypeId: z.string().optional(),
    q: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  component: ParticipantsTab,
});

function ParticipantsTab() {
  const t = useT();
  const event = useEventDetail();
  const { data: session } = useSession();
  // a suspended event is frozen for its organizer until an admin lifts it
  const locked = event.status === "suspended" && !hasRole(session?.user, ["admin"]);
  const navigate = Route.useNavigate();
  const { status, ticketTypeId, q = "", page = 1 } = Route.useSearch();
  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());

  useEffect(() => {
    if (debouncedSearch !== q) {
      void navigate({ search: (prev) => ({ ...prev, q: debouncedSearch || undefined, page: undefined }), replace: true });
    }
  }, [debouncedSearch, q, navigate]);

  const { data: types } = useQuery(ticketTypesQueryOptions(event.id));
  const { data, isPending, isError, refetch, isPlaceholderData } = useQuery({
    ...eventEnrollmentsQueryOptions(event.id, { page, pageSize: PAGE_SIZE, q: q || undefined, status, ticketTypeId }),
    placeholderData: keepPreviousData,
  });
  const columns = useMemo(() => enrollmentColumns(t, locked), [t, locked]);
  const counts = data?.counts;
  const all = counts ? STATUSES.reduce((sum, key) => sum + counts[key], 0) : undefined;
  const filtered = !!status || !!q || !!ticketTypeId;
  const typeItems = [
    { value: ALL_TYPES, label: t("eventAdmin.participants.allTypes") },
    ...(types ?? []).map((type) => ({ value: type.id, label: type.name })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Users className="size-5 text-primary dark:text-chart-2" />
          {t("eventAdmin.participants.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("eventAdmin.participants.description")}
        </p>
      </div>

      {/* nobody enrolled yet: point to what makes enrolling possible instead of an empty table */}
      {!isPending && all === 0 && !filtered ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>{t("eventAdmin.participants.empty.title")}</EmptyTitle>
            <EmptyDescription>
              {types?.length
                ? t("eventAdmin.participants.empty.withTypes")
                : t("eventAdmin.participants.empty.noTypes")}
            </EmptyDescription>
          </EmptyHeader>
          {!types?.length && (
            <EmptyContent>
              <Link
                to="/dashboard/events/$eventId/tickets/new"
                params={{ eventId: event.id }}
                className={buttonVariants()}
              >
                <TicketPlus data-icon="inline-start" />
                {t("eventAdmin.participants.empty.addType")}
              </Link>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <ToggleGroup
            variant="outline"
            className="flex-wrap"
            aria-label={t("eventAdmin.participants.filters.status")}
            value={[status ?? "all"]}
            onValueChange={(value: string[]) => {
              if (!value[0]) return;
              const next = value[0] === "all" ? undefined : (value[0] as EnrollmentStatus);
              void navigate({ search: (prev) => ({ ...prev, status: next, page: undefined }) });
            }}
          >
            <ToggleGroupItem value="all">
              <ListFilter />
              {t("eventAdmin.participants.filters.all")}
              {all !== undefined && <span className="text-muted-foreground tabular-nums">{all}</span>}
            </ToggleGroupItem>
            {STATUSES.map((value) => {
              const { label, icon: Icon } = enrollmentStatusInfo[value];
              return (
                <ToggleGroupItem key={value} value={value}>
                  <Icon />
                  {label}
                  {counts && <span className="text-muted-foreground tabular-nums">{counts[value]}</span>}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              items={typeItems}
              value={ticketTypeId ?? ALL_TYPES}
              onValueChange={(next) =>
                void navigate({
                  search: (prev) => ({ ...prev, ticketTypeId: !next || next === ALL_TYPES ? undefined : next, page: undefined }),
                })
              }
            >
              <SelectTrigger className="w-full sm:w-56" aria-label={t("eventAdmin.participants.filters.type")}>
                <Ticket className="text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {typeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <InputGroup className="w-full sm:w-72">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                enterKeyHint="search"
                placeholder={t("eventAdmin.participants.search.placeholder")}
                aria-label={t("eventAdmin.participants.search.label")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label={t("eventAdmin.participants.search.clear")} onClick={() => setSearch("")}>
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
              mobileHide={["ticket", "total", "createdAt"]}
              mobileFold={["status"]}
              error={isError && !data ? { onRetry: () => void refetch() } : undefined}
              isLoading={isPending}
              empty={{
                icon: SearchX,
                title: t("eventAdmin.participants.noMatch.title"),
                description: q ? t("eventAdmin.participants.noMatch.query", { q }) : t("eventAdmin.participants.noMatch.tryOther"),
                action: filtered && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      void navigate({ search: {} });
                    }}
                  >
                    <X data-icon="inline-start" />
                    {t("eventAdmin.participants.noMatch.clear")}
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
      )}
    </div>
  );
}
