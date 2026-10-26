import { alias, and, db, enrollments, eq, exists, inArray, isNotNull, isNull, lt, lte, notExists, or, payments, refunds, sql, ticketTypes } from "@app/db";
import { announceSeats, AnotherPaymentAccepted, confirmEnrollment, OverLimit, sendTicketMails } from "@app/tickets";
import type Stripe from "stripe";
import { issueRefund } from "./refund";
import { backoffMs, LEASE_MS, MAX_ATTEMPTS } from "./retry";

type Session = Stripe.Checkout.Session;
type PaymentRow = typeof payments.$inferSelect;
type Hold = "over_limit" | "exhausted" | "inconsistent";

// How a Checkout session's end reaches its enrollment, whether the webhook or the buyer's
// "check payment" brings the news. Each step first claims its payment row with a conditional
// update (pending → paid / expired), so news delivered twice is a no-op.

const paymentIntentOf = (session: Session) =>
  typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

/** A paid session confirms its enrollment. Anything that throws after the claim releases it, so a retry runs the whole step again. */
export async function settlePaid(session: Session) {
  const [payment] = await db
    .update(payments)
    // paid_at is the first claim's (a released and claimed again payment keeps its place among the order's payments);
    // recovery_next_at starts the lease, so recovery stays away while this runs
    .set({
      status: "paid",
      paidAt: sql`coalesce(${payments.paidAt}, now())`,
      stripePaymentIntentId: paymentIntentOf(session),
      recoveryNextAt: new Date(Date.now() + LEASE_MS),
      // polling's failures (reconcilePending) end here: what follows is settlement's own retry state
      recoveryAttempts: 0,
      recoveryHold: null,
    })
    .where(and(eq(payments.stripeSessionId, session.id), eq(payments.status, "pending")))
    .returning();
  // not ours, or already handled
  if (!payment) return;

  try {
    await finishPaid(payment);
  } catch (error) {
    // only if it's still ours: once a refund is recorded or underway for it, it stays what it is
    await db
      .update(payments)
      .set({ status: "pending", recoveryNextAt: null })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "paid"), notExists(db.select({ one: refunds.id }).from(refunds).where(eq(refunds.paymentId, payments.id)))));
    throw error;
  }
}

/** What Stripe says about a session, acted on as its webhook would. "unpaid": completed with a delayed method that hasn't paid yet. */
export async function settleSession(session: Session) {
  if (session.status === "complete" && session.payment_status === "paid") {
    await settlePaid(session);
    return "paid" as const;
  }
  if (session.status === "expired") {
    await settleUnpaid(session);
    return "expired" as const;
  }
  return session.status === "complete" ? ("unpaid" as const) : ("open" as const);
}

const hold = (payment: PaymentRow, reason: Hold) =>
  db.update(payments).set({ recoveryHold: reason }).where(and(eq(payments.id, payment.id), isNull(payments.recoveryHold)));

/**
 * What a claimed payment does to its order. Every step is idempotent (confirming a confirmed order, one refund
 * per payment), so it can run again, but only one run at a time per payment: the claim in settlePaid, or the lease in
 * recoverPayment, keeps two from refunding it together. "review": nothing was done and recovery stopped, a person has to decide.
 */
async function finishPaid(payment: PaymentRow) {
  // a paid row without its time can't be ranked against the order's other payments, and no time is made up for it
  if (!payment.paidAt) {
    await hold(payment, "inconsistent");
    console.error("Paid payment held for review: it has no paid_at", { paymentId: payment.id, enrollmentId: payment.enrollmentId });
    return "review" as const;
  }
  // the order's accepted payment is settled, however it came to be run again (a lost acknowledgement, a stale list)
  const [accepted] = await db
    .select({ id: enrollments.acceptedPaymentId })
    .from(enrollments)
    .where(and(eq(enrollments.id, payment.enrollmentId), eq(enrollments.acceptedPaymentId, payment.id)));
  if (accepted) {
    await sendTicketMails(payment.enrollmentId);
    return "done" as const;
  }
  // checkout reuses open sessions, so a second paid one is unexpected; the later of two is refunded in full, and ordering them
  // (not just "another is paid") means two paid at once can't refund each other
  const [earlier] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.enrollmentId, payment.enrollmentId),
        eq(payments.status, "paid"),
        isNotNull(payments.paidAt),
        or(lt(payments.paidAt, payment.paidAt), and(eq(payments.paidAt, payment.paidAt), lt(payments.id, payment.id))),
      ),
    )
    .limit(1);
  if (earlier) return await refund(payment, "duplicate");

  const result = await confirmEnrollment(payment.enrollmentId, payment.id);
  // confirmed by another payment meanwhile (the earlier one was released and this one got ahead of it)
  if (result instanceof AnotherPaymentAccepted) return await refund(payment, "duplicate");
  // not ours to decide: honouring it breaks the ticket limit, refunding it is a policy nobody wrote down
  if (result instanceof OverLimit) {
    await hold(payment, "over_limit");
    console.error("Paid payment held for review: it would take the buyer over the ticket limit", {
      paymentId: payment.id,
      enrollmentId: payment.enrollmentId,
    });
    return "review" as const;
  }
  // the hold ran out and its seats (or invitation) went to someone else meanwhile
  if (result instanceof Error) return await refund(payment, "unavailable");
  // the mails owed to the attendees were recorded with the confirmation; whoever finishes the order sends what's left of them
  await sendTicketMails(payment.enrollmentId);
  return "done" as const;
}

/** Nobody works on it before its recovery_next_at, and nobody at all while it is held for a person. */
export const available = () => and(isNull(payments.recoveryHold), or(isNull(payments.recoveryNextAt), lte(payments.recoveryNextAt, new Date())));

/** Paid, available, with no refund recorded or underway for it. */
export const unleasedPaid = () =>
  and(
    eq(payments.status, "paid"),
    // a paid row without its time is never worked on: the reconciler holds it (`inconsistent`), and no time is made up for it
    isNotNull(payments.paidAt),
    available(),
    notExists(db.select({ one: refunds.id }).from(refunds).where(eq(refunds.paymentId, payments.id))),
  );

const sibling = alias(payments, "sibling");

/**
 * Paid, unleased, and not yet settled: its order isn't confirmed, so it's confirmed or refunded now;
 * or it is, but another payment of that order was paid first, so this one is a duplicate to refund
 * (the process died after the first confirmed the order). A cancelled or rejected order's payment is
 * refunded as a late one always is. A confirmed order's first payment is done.
 */
export const recoverable = () =>
  and(
    unleasedPaid(),
    or(
      inArray(enrollments.status, ["awaiting_payment", "expired", "cancelled", "rejected"]),
      and(
        eq(enrollments.status, "confirmed"),
        or(
          // the accepted payment is the one that confirmed it; another is a duplicate
          and(isNotNull(enrollments.acceptedPaymentId), sql`${enrollments.acceptedPaymentId} <> ${payments.id}`),
          // an order confirmed before that was recorded: whichever was paid first
          and(
            isNull(enrollments.acceptedPaymentId),
            exists(
              db
                .select({ one: sql`1` })
                .from(sibling)
                .where(
                  and(
                    eq(sibling.enrollmentId, payments.enrollmentId),
                    eq(sibling.status, "paid"),
                    or(lt(sibling.paidAt, payments.paidAt), and(eq(sibling.paidAt, payments.paidAt), lt(sibling.id, payments.id))),
                  ),
                ),
            ),
          ),
        ),
      ),
    ),
  );

/**
 * Finishes a payment recorded as paid, if nobody else holds it; undefined when someone does. Taking it up counts an attempt
 * and starts a lease (recovery_next_at). A failure moves the next attempt out by a growing backoff, and after MAX_ATTEMPTS
 * holds it (`exhausted`) for a person; all of that is in the row, so restarts and replicas share it.
 */
export async function recoverPayment(paymentId: string) {
  const [payment] = await db
    .update(payments)
    .set({ recoveryAttempts: sql`${payments.recoveryAttempts} + 1`, recoveryNextAt: new Date(Date.now() + LEASE_MS) })
    .where(and(eq(payments.id, paymentId), unleasedPaid()))
    .returning();
  if (!payment) return undefined;
  try {
    return await finishPaid(payment);
  } catch (error) {
    const exhausted = payment.recoveryAttempts >= MAX_ATTEMPTS;
    await db
      .update(payments)
      .set({ recoveryNextAt: new Date(Date.now() + backoffMs(payment.recoveryAttempts)), ...(exhausted ? { recoveryHold: "exhausted" } : {}) })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "paid")));
    if (exhausted) console.error("Paid payment held for review: recovery failed too often", { paymentId: payment.id, enrollmentId: payment.enrollmentId });
    throw error;
  }
}

/**
 * A payment recorded as paid whose order never got confirmed: the process that claimed it died before it could finish, and Stripe's
 * retries and the buyer's check only ever look at pending payments. The buyer's check calls this so a paid order is never stuck;
 * libs/reconcile.ts does it for everyone, without waiting for the buyer. Both take the same lease and honour the same holds.
 */
export async function recoverPaid(buyerId: string, enrollmentId: string) {
  const stuck = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
    .where(and(eq(payments.enrollmentId, enrollmentId), eq(enrollments.buyerId, buyerId), recoverable()))
    .orderBy(payments.paidAt, payments.id);
  for (const { id } of stuck) await recoverPayment(id);
}

/**
 * Refunds a payment in full and closes its enrollment unless another payment confirmed it, then
 * tells the buyer (one made by hand needs them to get in touch).
 * The mail is recorded with the refund (libs/refund.ts), by whoever records it; a payment someone else is refunding, or already refunded, is left to them.
 */
async function refund(payment: PaymentRow, reason: "duplicate" | "unavailable") {
  const outcome = await issueRefund(payment, { percent: 100, initiatedBy: "system", note: reason });
  // the catch in settlePaid releases the payment, so a retry tries again
  if (outcome instanceof Error) throw outcome;
  return "done" as const;
}

/**
 * A session that ended without payment. A first_come or invite enrollment held its seats for
 * this session, so the hold is over; an approval one keeps its deadline (the buyer may try again).
 */
export async function settleUnpaid(session: Session) {
  const [payment] = await db
    .update(payments)
    // an ended session needs no more polling: its failure count and hold (reconcilePending) end with it
    .set({ status: "expired", recoveryHold: null, recoveryAttempts: 0 })
    .where(and(eq(payments.stripeSessionId, session.id), eq(payments.status, "pending")))
    .returning({ enrollmentId: payments.enrollmentId });
  if (!payment) return;

  const [row] = await db
    .select({ kind: ticketTypes.kind })
    .from(enrollments)
    .innerJoin(ticketTypes, eq(ticketTypes.id, enrollments.ticketTypeId))
    .where(eq(enrollments.id, payment.enrollmentId));
  if (row?.kind === "approval") return;
  // checkout opens a new session when the old one is about to end; the buyer's newer open session
  // keeps the hold (the next session to end, or the hold's own deadline, closes it)
  const [stillOpen] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.enrollmentId, payment.enrollmentId), eq(payments.status, "pending")))
    .limit(1);
  if (stillOpen) return;
  const [expired] = await db
    .update(enrollments)
    .set({ status: "expired" })
    .where(and(eq(enrollments.id, payment.enrollmentId), eq(enrollments.status, "awaiting_payment")))
    .returning({ eventId: enrollments.eventId });
  // the session can end before the hold does, freeing the seats early
  if (expired) announceSeats(expired.eventId);
}
