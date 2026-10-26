import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ClipboardCheck, Inbox, ListFilter } from "lucide-react";
import { z } from "zod";
import { DataTable } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/page-header";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/i18n";
import { applicationsQueryOptions, type ApplicationStatus } from "@/lib/organizer-applications";
import { hasRole } from "@/lib/session";
import { statusBadges, useApplicationColumns } from "./-components/applications-columns";

const filters = ["pending", "approved", "rejected", "all"] as const;

export const Route = createFileRoute("/_authed/dashboard/applications")({
  staticData: { title: "dashboard.applications.title" },
  validateSearch: z.object({ status: z.enum(filters).optional() }),
  beforeLoad: ({ context }) => {
    if (!hasRole(context.session.user, ["admin"])) throw redirect({ to: "/dashboard" });
  },
  component: ApplicationsPage,
});

function ApplicationsPage() {
  const t = useT();
  const columns = useApplicationColumns();
  const navigate = Route.useNavigate();
  const status = Route.useSearch({ select: (search) => search.status ?? "pending" });
  const { data, isPending, isError, refetch } = useQuery(
    applicationsQueryOptions(status === "all" ? undefined : (status as ApplicationStatus)),
  );

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        title={t("dashboard.applications.title")}
        description={t("dashboard.applications.description")}
        actions={
          <ToggleGroup
            variant="outline"
            className="max-w-full flex-wrap"
            value={[status]}
            onValueChange={(value: string[]) =>
              value[0] && navigate({ search: { status: value[0] as (typeof filters)[number] } })
            }
          >
            {filters.map((filter) => {
              const Icon = filter === "all" ? ListFilter : statusBadges[filter].icon;
              return (
                <ToggleGroupItem key={filter} value={filter}>
                  <Icon />
                  {filter === "all" ? t("dashboard.applications.filterAll") : statusBadges[filter].label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        }
      />
      <DataTable
        columns={columns}
        data={data ?? []}
        mobileHide={["reason", "createdAt"]}
        mobileFold={["organizationName", "status"]}
        error={isError && !data ? { onRetry: () => void refetch() } : undefined}
        isLoading={isPending}
        empty={{
          icon: Inbox,
          title: status === "pending" ? t("dashboard.applications.emptyPending") : t("dashboard.applications.empty"),
        }}
      />
    </>
  );
}
