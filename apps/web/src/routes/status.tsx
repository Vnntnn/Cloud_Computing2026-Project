import { createFileRoute } from "@tanstack/react-router";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { authClient, eventClient, paymentClient, registrationClient } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { useT } from "@/i18n";

export const Route = createFileRoute("/status")({
  staticData: { title: "pub.status.title" }, component: StatusPage });

type HealthCheck = () => Promise<{ data: string | null; error: unknown }>;

const services: { name: "auth" | "event" | "registration" | "payment"; check: HealthCheck }[] = [
  { name: "auth", check: () => authClient.api.auth.health.get() },
  { name: "event", check: () => eventClient.api.events.health.get() },
  { name: "registration", check: () => registrationClient.api.regis.health.get() },
  { name: "payment", check: () => paymentClient.api.payment.health.get() },
];

const healthKey = (name: string) => ["health", name];

function StatusPage() {
  const t = useT();
  const queryClient = useQueryClient();
  // read the same cached results the rows below use, to say in one line how the system is
  const pending = useIsFetching({ queryKey: ["health"] }) > 0;
  const states = services.map((s) => queryClient.getQueryState(healthKey(s.name))?.status);
  const down = states.some((s) => s === "error");
  const settled = states.every((s) => s === "success" || s === "error");
  const summary = !settled || pending ? t("pub.status.checking") : down ? t("pub.status.someDown") : t("pub.status.allOk");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-6">
      <PageHeader size="lg" title={t("pub.status.title")} description={t("pub.status.description")} />
      <p aria-live="polite" className={cn("text-lg font-semibold", settled && !pending && (down ? "text-destructive" : "text-primary dark:text-chart-2"))}>
        {summary}
      </p>
      <ul className="flex flex-col divide-y border-y">
        {services.map((service) => (
          <ServiceRow key={service.name} {...service} />
        ))}
      </ul>
    </div>
  );
}

function ServiceRow({ name, check }: { name: (typeof services)[number]["name"]; check: HealthCheck }) {
  const t = useT();
  const { data, isLoading, status } = useQuery({
    queryKey: healthKey(name),
    queryFn: async () => {
      const { data, error } = await check();
      if (error) throw error;
      return data;
    },
  });
  const Icon = status === "error" ? CircleX : status === "pending" ? LoaderCircle : CircleCheck;

  return (
    <li className="flex items-center justify-between gap-4 py-5">
      <h2 className="flex items-center gap-3 text-lg font-bold">
        <Icon className={cn("size-5 shrink-0", status === "error" ? "text-destructive" : status === "pending" ? "animate-spin text-muted-foreground" : "text-primary dark:text-chart-2")} />
        {t(`pub.status.services.${name}`)}
      </h2>
      <span className="flex items-center gap-3 text-sm">
        {isLoading && <span className="text-muted-foreground">{t("pub.status.loading")}</span>}
        {status === "error" && <span className="font-medium text-destructive">{t("pub.status.down")}</span>}
        {data && <span className="font-medium">{t("pub.status.ok")}</span>}
      </span>
    </li>
  );
}
