import type { Role } from "@app/auth-guard/permissions";
import { t } from "@/i18n";

// getters, so the label follows the current language
export const roleLabels: Record<Role, string> = {
  get user() {
    return t("shared.roles.user");
  },
  get organizer() {
    return t("shared.roles.organizer");
  },
  get admin() {
    return t("shared.roles.admin");
  },
};
