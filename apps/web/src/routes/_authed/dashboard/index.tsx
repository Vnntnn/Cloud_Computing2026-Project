import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { userCountQueryOptions } from "@/lib/admin-users";
import { formatNumber } from "@/lib/format";
import { pendingApplicationsQueryOptions } from "@/lib/organizer-applications";
import { hasRole, useSession } from "@/lib/session";
import { RecentEvents } from "./-components/recent-events";

export const Route = createFileRoute("/_authed/dashboard/")({
  staticData: { title: "dashboard.overview.title" }, component: Overview });

function Overview() {
  const t = useT();
  const { data: session } = useSession();
  const isAdmin = hasRole(session?.user, ["admin"]);

  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        title={t("dashboard.overview.title")}
        description={session ? t("dashboard.overview.greeting", { name: session.user.name }) : undefined}
      />
      {isAdmin && <Attention />}
      <RecentEvents title={isAdmin ? t("dashboard.overview.recent.adminTitle") : t("dashboard.overview.recent.ownTitle")} />
    </>
  );
}

/** What an admin has to act on (organizer requests, by name, each one click from its review) and, in a line, how big the user base is. */
function Attention() {
  const t = useT();
  const { data: pending, isPending } = useQuery(pendingApplicationsQueryOptions);
  const { data: users } = useQuery(userCountQueryOptions());
  const { data: organizers } = useQuery(userCountQueryOptions("organizer"));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.overview.attention.title")}</CardTitle>
        {users != null && organizers != null && (
          <CardDescription>{t("dashboard.overview.attention.summary", { users: formatNumber(users), organizers: formatNumber(organizers) })}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-12" />
        ) : !pending?.length ? (
          <p className="text-sm text-muted-foreground">{t("dashboard.overview.attention.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {pending.slice(0, 3).map((application) => (
              <li key={application.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{application.applicant.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{application.organizationName}</span>
                </span>
                <Link to="/dashboard/applications" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("dashboard.overview.attention.review")}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
