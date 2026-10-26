import { queryOptions } from "@tanstack/react-query";
import { Ban, CircleCheckBig, CircleX, Hourglass, Landmark, type LucideIcon } from "lucide-react";
import { t } from "@/i18n";
import { paymentClient } from "./api";
import { enrollmentsKey } from "./enrollments";

export type RefundStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled";

type BadgeVariant = "secondary" | "default" | "outline" | "destructive";

export const refundStatusInfo: Record<RefundStatus, { label: string; icon: LucideIcon; variant: BadgeVariant }> = {
  pending: { get label() { return t("shared.refundStatus.pending"); }, icon: Hourglass, variant: "secondary" },
  // made by hand (not a card payment, e.g. PromptPay): the buyer was mailed how to send us a bank account
  requires_action: { get label() { return t("shared.refundStatus.requires_action"); }, icon: Landmark, variant: "outline" },
  succeeded: { get label() { return t("shared.refundStatus.succeeded"); }, icon: CircleCheckBig, variant: "default" },
  failed: { get label() { return t("shared.refundStatus.failed"); }, icon: CircleX, variant: "destructive" },
  canceled: { get label() { return t("shared.refundStatus.canceled"); }, icon: Ban, variant: "outline" },
};

/** Why the system refunded a payment by itself (the refund's note). */
export const systemRefundReason: Record<string, string> = {
  get duplicate() {
    return t("shared.refundReason.duplicate");
  },
  get unavailable() {
    return t("shared.refundReason.unavailable");
  },
};

/** Stripe's failure_reason codes, translated; anything else shows as the code. */
export const refundFailureReason: Record<string, string> = {
  get lost_or_stolen_card() {
    return t("shared.refundFailure.lost_or_stolen_card");
  },
  get expired_or_canceled_card() {
    return t("shared.refundFailure.expired_or_canceled_card");
  },
  get declined() {
    return t("shared.refundFailure.declined");
  },
  get insufficient_funds() {
    return t("shared.refundFailure.insufficient_funds");
  },
  get charge_for_pending_refund_disputed() {
    return t("shared.refundFailure.charge_for_pending_refund_disputed");
  },
  get merchant_request() {
    return t("shared.refundFailure.merchant_request");
  },
};

/** Whether the buyer may still cancel for a refund under the order's terms. */
export const isRefundOpen = (terms: { deadline: string }) => new Date(terms.deadline) > new Date();

// under enrollmentsKey: a refund cancels its order, so invalidating enrollments refreshes both
export const eventRefundsKey = (eventId: string) => [...enrollmentsKey, "refunds", eventId] as const;

export const eventRefundsQueryOptions = (
  eventId: string,
  query: { page?: number; pageSize?: number; status?: RefundStatus },
) =>
  queryOptions({
    queryKey: [...eventRefundsKey(eventId), query],
    queryFn: async () => {
      const { data, error } = await paymentClient.api.payment.events({ eventId }).refunds.get({ query });
      if (error) throw error;
      return data;
    },
  });

export type EventRefund = NonNullable<
  Awaited<ReturnType<ReturnType<typeof paymentClient.api.payment.events>["refunds"]["get"]>>["data"]
>["items"][number];
