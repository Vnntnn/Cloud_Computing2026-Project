import { CursorRing } from "@/components/cursor-ring";
import Navbar from "@/components/navbar";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet, useRouterState } from "@tanstack/react-router";
import { usePageTitle } from "@/hooks/use-page-title";
import { useT } from "@/i18n";

/**
 * The two playful touches, kept where they help. The cursor ring is off in the dashboard (nobody should chase a ring while working).
 * The dot grid is only behind the events listing: discovery is the one page that wants a light, printed-paper ground; on tickets, orders,
 * account and status pages it was texture with no purpose.
 */
function PointerFlair() {
  const operating = useRouterState({ select: (s) => s.location.pathname.startsWith("/dashboard") });
  return operating ? null : <CursorRing />;
}

function DotGrid() {
  const onListing = useRouterState({ select: (s) => s.location.pathname === "/events" || s.location.pathname.startsWith("/events/categories") });
  return onListing ? <div aria-hidden className="page-backdrop" /> : null;
}

/**
 * The tab title of a page whose route declares `staticData.title`. Pages whose title carries the viewer's data (an event's name, a
 * ticket) call usePageTitle themselves and declare nothing here. It follows the language, since the message is looked up on each render.
 */
function PageTitle() {
  const t = useT();
  const key = useRouterState({ select: (s) => [...s.matches].reverse().find((m) => m.staticData?.title)?.staticData.title });
  usePageTitle(key ? t(key) : undefined);
  return null;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="relative isolate">
      <PageTitle />
      <DotGrid />
      <PointerFlair />
      <Navbar />
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  ),
});
