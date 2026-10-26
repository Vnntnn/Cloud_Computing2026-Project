import { queryOptions } from "@tanstack/react-query";
import { AlignLeft, ListChecks, MailCheck, TextCursorInput, UserCheck, Zap, type LucideIcon } from "lucide-react";
import { t } from "@/i18n";
import { eventClient } from "./api";
import { retryUnlessClientError } from "./events";

export type TicketKind = "first_come" | "approval" | "invite";
export type QuestionType = "short_text" | "long_text" | "choice";

export const kindInfo: Record<TicketKind, { label: string; description: string; icon: LucideIcon }> = {
  first_come: {
    get label() {
      return t("shared.ticketKind.first_come.label");
    },
    get description() {
      return t("shared.ticketKind.first_come.description");
    },
    icon: Zap,
  },
  approval: {
    get label() {
      return t("shared.ticketKind.approval.label");
    },
    get description() {
      return t("shared.ticketKind.approval.description");
    },
    icon: UserCheck,
  },
  invite: {
    get label() {
      return t("shared.ticketKind.invite.label");
    },
    get description() {
      return t("shared.ticketKind.invite.description");
    },
    icon: MailCheck,
  },
};

export const questionTypeInfo: Record<QuestionType, { label: string; icon: LucideIcon }> = {
  short_text: { get label() { return t("shared.questionType.short_text"); }, icon: TextCursorInput },
  long_text: { get label() { return t("shared.questionType.long_text"); }, icon: AlignLeft },
  choice: { get label() { return t("shared.questionType.choice"); }, icon: ListChecks },
};

/** The services' limits (apps/event ticket-types model, apps/registration). */
export const MIN_PAID_PRICE = 20;
export const MAX_QUESTIONS = 30;
export const MAX_OPTIONS = 20;
export const SHORT_TEXT_MAX = 200;
export const LONG_TEXT_MAX = 2000;

export const ticketTypesKey = (eventId: string) => ["ticket-types", eventId] as const;

// the id may also be a slug
export const ticketTypesQueryOptions = (idOrSlug: string) =>
  queryOptions({
    queryKey: ticketTypesKey(idOrSlug),
    queryFn: async () => {
      const { data, error } = await eventClient.api.events({ id: idOrSlug })["ticket-types"].get();
      if (error) throw error;
      return data;
    },
    retry: retryUnlessClientError,
  });

export type TicketType = NonNullable<
  Awaited<ReturnType<ReturnType<typeof eventClient.api.events>["ticket-types"]["get"]>>["data"]
>[number];

export type Question = TicketType["questions"][number];

/** Field each of the event service's problem codes belongs to, so the editor shows it in place. */
export const ticketTypeProblemFields: Record<string, string> = {
  INVALID_PRICE: "price",
  INVALID_QUOTA: "quota",
  QUOTA_BELOW_TAKEN: "quota",
  KIND_LOCKED: "kind",
};
