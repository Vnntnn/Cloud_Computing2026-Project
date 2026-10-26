import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A bordered block of the profile page: heading, optional hint, then content. */
export function Section({
  title,
  description,
  badge,
  tone,
  children,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  tone?: "destructive";
  children?: ReactNode;
}) {
  return (
    <section data-slot="profile-section" className={cn("flex flex-col gap-5 rounded-md border bg-card p-5 md:p-7", tone === "destructive" && "border-destructive/40")}>
      <div className="flex flex-col gap-1.5">
        <h2 className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xl leading-snug font-bold tracking-tight", tone === "destructive" && "text-destructive")}>
          {title}
          {badge}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
