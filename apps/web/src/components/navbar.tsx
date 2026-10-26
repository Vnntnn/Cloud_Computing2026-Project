import { Link } from "@tanstack/react-router";
import { LayoutDashboard, LogIn, Telescope, Ticket, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { hasRole, useSession } from "@/lib/session";
import { cn } from "cn";

// a link of the bar: ghost, with its icon (the label gives way to the icon below sm); the page you are on is tinted
const navLink = cn(buttonVariants({ variant: "ghost" }), "font-bold data-[status=active]:bg-muted data-[status=active]:text-primary dark:data-[status=active]:text-chart-2");

export default function Navbar() {
  const t = useT();
  const { data: session, isPending } = useSession();
  // a page whose first screen is ink says so with <InkScene />; the bar then takes that colour at the top of the page, so the two read as one surface
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const update = () => setAtTop(window.scrollY < 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header data-slot="navbar" data-top={atTop} className="sticky top-0 z-20 flex h-17 w-full items-center justify-center border-b bg-background p-4 transition-colors duration-300">
      <div className="container flex w-full items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 rounded-lg text-2xl font-bold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <img src="/favicon.svg" alt="" className="size-8" />
          {/* on a phone the icons need the room (a third link for organizers and admins needs more of it); the logo mark stays */}
          <span className={cn(hasRole(session?.user, ["organizer", "admin"]) ? "max-[26rem]:sr-only" : "max-[22rem]:sr-only")}>Eventide</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <LanguageSwitch />
          <ThemeToggle />
          <Link to="/events" className={navLink}>
            <Telescope data-icon="inline-start" />
            <span className="max-sm:sr-only">{t("common.nav.explore")}</span>
          </Link>
          {/* where the account's own pages are one click away, not only in the user menu */}
          {session && (
            <Link to="/tickets" className={navLink}>
              <Ticket data-icon="inline-start" />
              <span className="max-sm:sr-only">{t("common.userMenu.tickets")}</span>
            </Link>
          )}
          {hasRole(session?.user, ["organizer", "admin"]) && (
            <Link to="/dashboard" className={navLink}>
              <LayoutDashboard data-icon="inline-start" />
              <span className="max-sm:sr-only">{t("common.userMenu.dashboard")}</span>
            </Link>
          )}
          {isPending ? (
            <Skeleton className="size-10 rounded-full" />
          ) : session ? (
            <UserMenu user={session.user} />
          ) : (
            <>
              <Link to="/login" className={cn(buttonVariants({ variant: "outline" }), "nav-outline")}>
                <LogIn data-icon="inline-start" />
                <span className="max-sm:sr-only">{t("common.nav.login")}</span>
              </Link>
              <Link to="/register" className={buttonVariants({ variant: "default" })}>
                <UserPlus data-icon="inline-start" />
                <span className="max-sm:sr-only">{t("common.nav.register")}</span>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

/**
 * Put this on a page whose first screen is the ink scene (the home hero, an event's hero, the sign-in panel): while the page is
 * at the top, the navbar takes the scene's colour. It is gone again when the page unmounts.
 */
export function InkScene() {
  useEffect(() => {
    document.documentElement.dataset.scene = "ink";
    return () => {
      delete document.documentElement.dataset.scene;
    };
  }, []);
  return null;
}
