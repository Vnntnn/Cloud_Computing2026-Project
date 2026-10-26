import { createFileRoute, redirect } from "@tanstack/react-router";

import { OrganizerApplication } from "@/components/organizer-application";
import { useT } from "@/i18n";
import { Section } from "./-components/section";

export const Route = createFileRoute("/_authed/profile/organizer")({
  staticData: { title: "account.profile.layout.nav.organizer" },
  // admins already manage organizers, so there is nothing to apply for
  beforeLoad: ({ context }) => {
    if (context.session.user.role === "admin") throw redirect({ to: "/profile" });
  },
  component: OrganizerPage,
});

function OrganizerPage() {
  const t = useT();
  return (
    <Section
      title={t("account.profile.organizer.title")}
      description={t("account.profile.organizer.description")}
    >
      <OrganizerApplication />
    </Section>
  );
}
