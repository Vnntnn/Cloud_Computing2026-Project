import { and, db, enrollments, eq, isNull, lte, or, payments, refunds, sql } from "@app/db";
import { dispatchNotifications, markCancelled, queueNotifications, refundSatang, type Tx } from "@app/tickets";
import Stripe from "stripe";
import { RefundRejected, RefundUnavailable } from "./errors";
import { composeCancellation, composeRefundCanceled, composeRefundFailed, composeSystemRefund } from "./mail";
import { backoffMs, MAX_ATTEMPTS } from "./retry";
import { stripe } from "./stripe";

type PaymentRow = typeof payments.$inferSelect;
type RefundRow = typeof refunds.$inferSelect;
type RefundStatus = RefundRow["status"];

const refundStatuses: RefundStatus[] = ["pending", "requires_action", "succeeded", "failed", "canceled"];

/** Stripe's refund status as ours; a missing or unknown one reads as still in progress. */
export const toRefundStatus = (status: string | null): RefundStatus =>
  refundStatuses.find((known) => known === status) ?? "pending";

type RefundInput = {
  // of the payment's amount
  percent: number;
  initiatedBy: "buyer" | "organizer" | "system";
  requestedBy?: string;
  note?: string;
};

// How a payment is refunded, whichever of the paths asks (the buyer, the organizer, the system for a duplicate, a late payment
// or a cancelled order). One refund per payment: the unique index on refunds.payment_id is the claim, and `percent` is 1–100 of
// the payment's amount, so however the paths race they can't give back more than was paid.
//
//   1. claim    a refund row is inserted before Stripe is asked, as an intent: status pending, no stripe_refund_id.
//               Whoever inserts it owns it; the others find it and either wait (its lease is live: it is in flight) or take it
//               over (the lease ran out: its owner died).
//   2. ask      Stripe is asked with an idempotency key derived from the row's id, so a retry, by this process or after a crash,
//               gets the same refund back rather than making another. A refusal for good deletes the intent (the next attempt
//               is a new row and key: Stripe would replay the refusal for a day under the old one); anything else leaves it.
//   3. record   the Stripe id and status, the payment (refunded) and the order (cancelled, or expired) change together.
// One not made through Stripe (a payment that isn't a card's, e.g. PromptPay) skips step 2 and is recorded as requires_action.

/** How long an intent belongs to the process that made it: the slowest run of step 2. */
export const INTENT_LEASE_MS = 3 * 60_000;

/** Whether the refund is an intent: Stripe was never answered, so it may or may not have made it. */
export const isIntent = (refund: Pick<RefundRow, "status" | "stripeRefundId">) =>
  refund.status === "pending" && refund.stripeRefundId === null;

/**
 * A refund Stripe made for this payment that an earlier attempt didn't record, found by the payment id in its metadata. The
 * idempotency key covers a retry within Stripe's retention of it (24 hours); this covers an intent that outlived that. One that
 * failed or was cancelled gave nothing back.
 */
async function unrecordedRefund(paymentIntentId: string, paymentId: string) {
  const { data } = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  return data.find(
    (refund) => refund.metadata?.paymentId === paymentId && refund.status !== "failed" && refund.status !== "canceled",
  );
}

/** Whether the payment was made by card (the charge's payment method; a wallet such as Apple Pay counts). */
async function paidByCard(paymentIntentId: string) {
  const { data } = await stripe.charges.list({ payment_intent: paymentIntentId, limit: 1 });
  // a paid payment without a charge can't be told from a card's: not answering is safer than asking the buyer for a bank account
  if (!data[0]) throw new Error(`No charge found for payment intent ${paymentIntentId}`);
  return data[0].payment_method_details?.type === "card";
}

/**
 * Step 1: records the intent to refund `percent` of the payment. Run it in the transaction that decided the refund is due
 * (it commits with it); it takes no part in the Stripe call. `owned`: this call made the row.
 */
export async function claimRefund(executor: typeof db | Tx, payment: PaymentRow, input: RefundInput) {
  const amount = refundSatang(Number(payment.amount), input.percent);
  if (amount > Math.round(Number(payment.amount) * 100)) throw new Error(`Refund of ${payment.id} would exceed the payment`);
  const [created] = await executor
    .insert(refunds)
    .values({
      enrollmentId: payment.enrollmentId,
      paymentId: payment.id,
      amount: (amount / 100).toFixed(2),
      percent: input.percent,
      status: "pending",
      initiatedBy: input.initiatedBy,
      requestedBy: input.requestedBy,
      note: input.note,
      recoveryNextAt: new Date(Date.now() + INTENT_LEASE_MS),
    })
    .onConflictDoNothing({ target: refunds.paymentId })
    .returning();
  if (created) return { refund: created, owned: true };
  const [existing] = await executor.select().from(refunds).where(eq(refunds.paymentId, payment.id));
  return { refund: existing!, owned: false };
}

/** Takes an intent over if nobody holds its lease and it isn't held for a person. `scheduler` counts the attempt. */
export async function takeIntent(refund: RefundRow, scheduler = false) {
  const [taken] = await db
    .update(refunds)
    .set({
      recoveryNextAt: new Date(Date.now() + INTENT_LEASE_MS),
      ...(scheduler ? { recoveryAttempts: sql`${refunds.recoveryAttempts} + 1` } : {}),
    })
    .where(
      and(
        eq(refunds.id, refund.id),
        eq(refunds.status, "pending"),
        isNull(refunds.stripeRefundId),
        isNull(refunds.recoveryHold),
        or(isNull(refunds.recoveryNextAt), lte(refunds.recoveryNextAt, new Date())),
      ),
    )
    .returning();
  return taken;
}

/** A claimed refund through steps 2 and 3. `performed`: this call recorded it (the caller announces and mails); false: someone else had. `inFlight`: its owner is still on it. */
export async function runRefund(claim: { refund: RefundRow; owned: boolean }, payment: PaymentRow) {
  if (claim.owned) return await executeRefund(claim.refund, payment);
  // made earlier: recorded already, or an intent
  if (!isIntent(claim.refund)) return { refund: claim.refund, performed: false as const };
  const taken = await takeIntent(claim.refund);
  // `waiting`: not in anyone's hands now but backing off or held, so "already refunded" would be untrue: the caller says to try later
  if (!taken) return { inFlight: true as const, waiting: claim.refund.recoveryAttempts > 0 || claim.refund.recoveryHold !== null };
  return await executeRefund(taken, payment);
}

/** Steps 2 and 3 for an intent this process holds the lease of. */
export async function executeRefund(refund: RefundRow, payment: PaymentRow) {
  const paymentIntentId = payment.stripePaymentIntentId;
  if (!paymentIntentId) throw new Error(`Paid session without a payment intent: ${payment.stripeSessionId}`);
  const amount = Math.round(Number(refund.amount) * 100);
  // null: made by hand
  let made: Stripe.Refund | null = null;
  try {
    if (await paidByCard(paymentIntentId)) {
      made =
        (await unrecordedRefund(paymentIntentId, payment.id)) ??
        (await stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount,
            metadata: { enrollmentId: payment.enrollmentId, paymentId: payment.id, initiatedBy: refund.initiatedBy },
          },
          { idempotencyKey: `refund-${refund.id}` },
        ));
    }
  } catch (error) {
    console.error("Failed to create a Stripe refund", error);
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      await db.delete(refunds).where(and(eq(refunds.id, refund.id), eq(refunds.status, "pending"), isNull(refunds.stripeRefundId)));
      return new RefundRejected();
    }
    // it may have been made: the intent stays, free to take up again
    await db.update(refunds).set({ recoveryNextAt: null }).where(and(eq(refunds.id, refund.id), isNull(refunds.stripeRefundId)));
    return new RefundUnavailable();
  }
  return await recordRefund(refund, payment, made);
}

/** Step 3. The enrollment is locked first, the order every transaction here takes its locks in. The mails it owes are recorded with it and sent after the commit. */
async function recordRefund(refund: RefundRow, payment: PaymentRow, made: Stripe.Refund | null) {
  const recorded = await db.transaction(async (tx) => {
    const [enrollment] = await tx.select().from(enrollments).where(eq(enrollments.id, refund.enrollmentId)).for("update");
    const [updated] = await tx
      .update(refunds)
      .set({
        status: made ? toRefundStatus(made.status) : "requires_action",
        stripeRefundId: made?.id ?? null,
        recoveryNextAt: null,
        recoveryHold: null,
      })
      .where(and(eq(refunds.id, refund.id), eq(refunds.status, "pending"), isNull(refunds.stripeRefundId)))
      .returning();
    // another run recorded it first
    if (!updated) return { refund: (await tx.select().from(refunds).where(eq(refunds.id, refund.id)))[0]!, performed: false as const };

    await tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, payment.id));
    if (enrollment) {
      if (refund.initiatedBy !== "system" && enrollment.status === "confirmed") await markCancelled(tx, enrollment);
      // only a lapsed hold; a rejected or cancelled order keeps its status, and a duplicate leaves the order it confirmed
      if (refund.initiatedBy === "system" && refund.note === "unavailable" && enrollment.status === "awaiting_payment") {
        await tx.update(enrollments).set({ status: "expired" }).where(eq(enrollments.id, enrollment.id));
      }
    }
    // the buyer (and the attendees, when the order is cancelled) hear about it in the same transaction as the change
    await queueNotifications(tx, refund.initiatedBy === "system" ? await composeSystemRefund(tx, updated) : await composeCancellation(tx, updated));
    // already failed or cancelled when Stripe first answered (rare): the later webhook finds it terminal and says nothing, so say it here
    if (updated.status === "failed") await queueNotifications(tx, await composeRefundFailed(tx, updated));
    if (updated.status === "canceled") await queueNotifications(tx, await composeRefundCanceled(tx, updated));
    return { refund: updated, performed: true as const };
  });
  if (recorded.performed) await dispatchNotifications({ enrollmentId: refund.enrollmentId });
  return recorded;
}

/** Claim and run in one go, for the paths that have no transaction of their own to claim in. */
export async function issueRefund(payment: PaymentRow, input: RefundInput) {
  return await runRefund(await claimRefund(db, payment, input), payment);
}

/** After a failed attempt by the scheduler: when to try again, or a hold once the attempts are used up. */
export async function noteRefundFailure(refund: RefundRow, attempts: number) {
  const exhausted = attempts >= MAX_ATTEMPTS;
  await db
    .update(refunds)
    .set({ recoveryNextAt: new Date(Date.now() + backoffMs(attempts)), recoveryHold: exhausted ? "exhausted" : null })
    .where(and(eq(refunds.id, refund.id), eq(refunds.status, "pending"), isNull(refunds.stripeRefundId)));
  return exhausted;
}
