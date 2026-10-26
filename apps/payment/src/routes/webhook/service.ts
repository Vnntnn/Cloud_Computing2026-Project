import { and, db, eq, notInArray, refunds } from "@app/db";
import { dispatchNotifications, queueNotifications } from "@app/tickets";
import type Stripe from "stripe";
import { composeRefundCanceled, composeRefundFailed } from "../../libs/mail";
import { toRefundStatus } from "../../libs/refund";
import { settlePaid, settleUnpaid } from "../../libs/settle";

/**
 * Handles the Checkout events this service cares about (libs/settle.ts claims each payment once,
 * so a redelivered event is a no-op, and one that throws is run again by Stripe's retry).
 * Refund events update the refund they're about.
 */
export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      // a delayed method (e.g. a bank transfer) completes unpaid; async_payment_succeeded follows
      if (event.data.object.payment_status === "paid") await settlePaid(event.data.object);
      return;
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await settleUnpaid(event.data.object);
      return;
    case "refund.updated":
    case "refund.failed":
      await settleRefund(event.data.object);
      return;
  }
}

/**
 * A refund's new status (e.g. PromptPay's requires_action → pending → succeeded, or a card refund
 * that fails days later). failed and canceled are final, and succeeded only moves on to failed, so an
 * older event delivered late can't undo them; the buyer hears about a failure once.
 */
async function settleRefund(stripeRefund: Stripe.Refund) {
  const status = toRefundStatus(stripeRefund.status);
  // a succeeded refund only moves on to failed; a late in-progress event can't undo it
  // (a refund that succeeded doesn't become cancelled either; only a failure can follow it, days later, for a card)
  const final: (typeof status)[] = status === "pending" || status === "requires_action" || status === "canceled" ? ["failed", "canceled", "succeeded"] : ["failed", "canceled"];
  // the failure and the mail that tells the buyer are recorded together; the mail is sent after the commit
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(refunds)
      .set({ status, failureReason: stripeRefund.failure_reason ?? null })
      .where(and(eq(refunds.stripeRefundId, stripeRefund.id), notInArray(refunds.status, final)))
      .returning();
    // the buyer is told once, when the refund reaches an end that didn't return the money (a later stale event can't move it again)
    if (row?.status === "failed") await queueNotifications(tx, await composeRefundFailed(tx, row));
    if (row?.status === "canceled") await queueNotifications(tx, await composeRefundCanceled(tx, row));
    return row;
  });
  if (updated) {
    if (updated.status === "failed" || updated.status === "canceled") await dispatchNotifications({ enrollmentId: updated.enrollmentId });
    return;
  }
  // ours (it carries our metadata) but not recorded: the request that made it hasn't committed
  // yet, so throw and let Stripe deliver it again. Refunds made in the Stripe Dashboard are ignored.
  if (stripeRefund.metadata?.paymentId) {
    const [known] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.stripeRefundId, stripeRefund.id));
    if (!known) throw new Error(`Refund ${stripeRefund.id} isn't recorded yet`);
  }
}
