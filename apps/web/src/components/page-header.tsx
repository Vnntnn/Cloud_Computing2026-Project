import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

/**
 * The title of a page. `md` (default) is the working size, for the dashboard and forms; `lg` is for public and account pages,
 * where the title is the first thing on the page and gets editorial scale. Thai gets a taller line than Latin so marks aren't clipped.
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  size = "md",
  className,
}: {
  /** the working size carries an icon that echoes the sidebar; the editorial `lg` title is type alone and ignores it */
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  const lg = size === "lg";
  return (
    <div data-slot="page-header" className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h1
          className={cn(
            "flex items-start gap-3 font-bold tracking-tight text-balance",
            lg ? "text-4xl leading-[1.25] sm:text-5xl sm:leading-[1.25]" : "text-2xl leading-[1.3] sm:text-3xl sm:leading-[1.3]",
          )}
        >
          {Icon && !lg && <Icon className="mt-1 size-6 shrink-0 text-primary sm:mt-1.5 sm:size-7 dark:text-chart-2" />}
          {title}
        </h1>
        {description && <p className={cn("max-w-2xl text-balance text-muted-foreground", lg ? "text-base sm:text-lg" : "text-sm sm:text-base")}>{description}</p>}
      </div>
      {actions}
    </div>
  );
}
