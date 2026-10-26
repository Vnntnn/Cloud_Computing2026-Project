import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Search, UserRoundSearch, Users } from "lucide-react";
import { useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { PageHeader } from "@/components/page-header";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useT } from "@/i18n";
import { usersQueryOptions } from "@/lib/admin-users";
import { hasRole, useSession } from "@/lib/session";
import { useUserColumns } from "./-components/users-columns";

export const Route = createFileRoute("/_authed/dashboard/users")({
  staticData: { title: "dashboard.users.title" },
  beforeLoad: ({ context }) => {
    if (!hasRole(context.session.user, ["admin"])) throw redirect({ to: "/dashboard" });
  },
  component: UsersPage,
});

function UsersPage() {
  const t = useT();
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const { data, isPending, isError, refetch } = useQuery(usersQueryOptions({ ...pagination, search: debouncedSearch }));
  const columns = useUserColumns(session?.user.id);

  return (
    <>
      <PageHeader
        icon={Users}
        title={t("dashboard.users.title")}
        description={t("dashboard.users.description")}
        actions={
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder={t("dashboard.users.searchPlaceholder")}
              aria-label={t("dashboard.users.searchLabel")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPagination((current) => ({ ...current, pageIndex: 0 }));
              }}
            />
          </InputGroup>
        }
      />
      <DataTable
        columns={columns}
        data={data?.users ?? []}
        mobileHide={["createdAt"]}
        mobileFold={["role", "banned"]}
        error={isError && !data ? { onRetry: () => void refetch() } : undefined}
        isLoading={isPending}
        empty={{
          icon: UserRoundSearch,
          title: t("dashboard.users.emptyTitle"),
          description: debouncedSearch ? t("dashboard.users.emptyDescription", { q: debouncedSearch }) : undefined,
        }}
        pagination={{ state: pagination, onChange: setPagination, rowCount: data?.total ?? 0 }}
      />
    </>
  );
}
