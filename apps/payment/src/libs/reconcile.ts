import { and, asc, db, enrollments, eq, exists, recordMissingResetMails, inArray, isNull, lt, not, or, payments, refunds, sql, ticketMailOutbox, tickets, notificationOutbox } from "@app/db";
import { announceSeats, dispatchNotifications, dispatchTicketMails } from "@app/tickets";
import { executeRefund, noteRefundFailure, takeIntent } from "./refund";
import { available, recoverable, recoverPayment, settleSession } from "./settle";
import { backoffMs } from "./retry";
import { stripe } from "./stripe";

// What the payment service repairs on a timer, in case the process that should have finished something died or never heard of it.
// Replicas may all run it: every record is taken with a lease first (libs/retry.ts), and the attempts, backoff and holds are kept
// in the rows, so a restart forgets nothing. It only reads from Stripe (sessions, charges, refunds), and the one thing it asks
// Stripe to do is what a refund already owed asks for, under its stable idempotency key.
const BATCH = 20;
const INTERVAL_MS = 60_000;
// a session the webhook hasn't settled is asked about once it's this old
const PENDING_AFTER_MS = 10 * 60_000;
// consecutive failed lookups of one session before polling it stops and a person is told (`exhausted`): about three hours of
// backoff (2, 4, 8, 16, 32, 60, 60 minutes). Asking Stripe wasn't the buyer's doing, so the buyer's own check keeps working,
// and /recovery/payments/:id/resume starts the polling again.
const MAX_POLL_ERRORS = 8;

// `halt`: asked between records, so a shutdown doesn't wait for a whole batch
type Scope = { only?: string[]; limit?: number; halt?: () => boolean };

const orders = (column: typeof payments.enrollmentId | typeof refunds.enrollmentId, only?: string[]) => (only ? inArray(column, only) : undefined);

/**
 * Payments recorded as paid whose order isn't settled, oldest first, at most `limit`. Only what's in the database counts: a payment is
 * paid because the webhook (or the buyer's check, asking Stripe) said so, never because of a redirect. One that already has a refund,
 * or whose order is still `pending`, is held (`inconsistent`) and reported, not touched. `only` narrows it to some orders (tests).
 */
export async function reconcilePaid({ only, limit = BATCH, halt }: Scope = {}) {
  const report = { recovered: 0, review: 0, failed: 0, ambiguous: 0 };

  const odd = await db
    .select({ id: payments.id, enrollmentId: payments.enrollmentId, status: enrollments.status })
    .from(payments)
    .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
    .where(
      and(
        eq(payments.status, "paid"),
        available(),
        orders(payments.enrollmentId, only),
        or(
          eq(enrollments.status, "pending"),
          // no time it was paid at: it can't be ranked or settled
          isNull(payments.paidAt),
          // a refund recorded for it, though still paid; an intent that isn't recorded yet is a refund underway, not an oddity
          exists(
            db
              .select({ one: refunds.id })
              .from(refunds)
              .where(and(eq(refunds.paymentId, payments.id), not(and(eq(refunds.status, "pending"), isNull(refunds.stripeRefundId))!))),
          ),
        ),
      ),
    )
    .limit(limit);
  for (const row of odd) {
    await db.update(payments).set({ recoveryHold: "inconsistent" }).where(and(eq(payments.id, row.id), isNull(payments.recoveryHold)));
    report.ambiguous++;
    console.error("Paid payment held for review: it has no paid_at, already has a refund, or its order is still pending", {
      paymentId: row.id,
      enrollmentId: row.enrollmentId,
      orderStatus: row.status,
    });
  }

  const stuck = await db
    .select({ id: payments.id, enrollmentId: payments.enrollmentId })
    .from(payments)
    .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
    .where(and(recoverable(), orders(payments.enrollmentId, only)))
    .orderBy(asc(payments.paidAt), asc(payments.id))
    .limit(limit);
  for (const { id, enrollmentId } of stuck) {
    if (halt?.()) break;
    try {
      const outcome = await recoverPayment(id);
      if (outcome === "done") report.recovered++;
      else if (outcome === "review") report.review++;
    } catch (error) {
      report.failed++;
      console.error("Failed to recover a paid payment", { paymentId: id, enrollmentId, error: error instanceof Error ? error.name : "unknown" });
    }
  }
  return report;
}

/** Refund intents (libs/refund.ts) whose owner died or whose Stripe call was left unanswered: asked again under the same key, then recorded. */
export async function resumeRefunds({ only, limit = BATCH, halt }: Scope = {}) {
  const report = { resumed: 0, failed: 0 };
  const intents = await db
    .select()
    .from(refunds)
    .where(
      and(
        eq(refunds.status, "pending"),
        isNull(refunds.stripeRefundId),
        isNull(refunds.recoveryHold),
        or(isNull(refunds.recoveryNextAt), lt(refunds.recoveryNextAt, new Date())),
        orders(refunds.enrollmentId, only),
      ),
    )
    .orderBy(asc(refunds.createdAt))
    .limit(limit);
  for (const intent of intents) {
    if (halt?.()) break;
    const refund = await takeIntent(intent, true);
    if (!refund) continue;
    try {
      const [payment] = await db.select().from(payments).where(eq(payments.id, refund.paymentId));
      const outcome = await executeRefund(refund, payment!);
      if (outcome instanceof Error) throw outcome;
      report.resumed++;
      // the mails were recorded with the refund and sent by the step that recorded it
      if (outcome.performed && refund.initiatedBy !== "system") {
        const [enrollment] = await db.select({ eventId: enrollments.eventId }).from(enrollments).where(eq(enrollments.id, refund.enrollmentId));
        if (enrollment) announceSeats(enrollment.eventId);
      }
    } catch (error) {
      report.failed++;
      const exhausted = await noteRefundFailure(refund, refund.recoveryAttempts);
      console.error(`Failed to finish a refund${exhausted ? ", held for review" : ""}`, {
        refundId: refund.id,
        paymentId: refund.paymentId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return report;
}

/**
 * Sessions the webhook never settled: a pending payment older than PENDING_AFTER_MS is asked about at Stripe (a read of the
 * session, never a redirect's say-so) and settled as the webhook would have, by the same code. What each answer does:
 *   paid → settlePaid (over the ticket limit, duplicate, lapsed hold: finishPaid's own rules);  expired → settleUnpaid;
 *   open → asked again when the session ends (at most an hour on), and the failure count starts over;
 *   complete but unpaid (a delayed method) → asked again in half an hour, nothing else happens;
 *   the lookup itself failed (timeout, rate limit, network) → recovery_attempts counts it and the next try is backed off
 *   (libs/retry.ts), and after MAX_POLL_ERRORS in a row the payment is held (`exhausted`).
 * All of it is in the row, so restarts and replicas share it. A settled payment isn't pending any more, so it's never asked
 * about twice; a pending payment of an order that is cancelled or confirmed meanwhile still is, until its session ends, because
 * money can still arrive on it and would have to be refunded. Nothing is refunded or charged here beyond what settling does.
 */
export async function reconcilePending({ only, limit = BATCH, halt }: Scope = {}) {
  const report = { settled: 0, waiting: 0, failed: 0 };
  const stale = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.status, "pending"), lt(payments.createdAt, new Date(Date.now() - PENDING_AFTER_MS)), available(), orders(payments.enrollmentId, only)))
    .orderBy(asc(payments.createdAt))
    .limit(limit);
  for (const { id } of stale) {
    if (halt?.()) break;
    const [payment] = await db
      .update(payments)
      .set({ recoveryNextAt: new Date(Date.now() + 10 * 60_000) })
      .where(and(eq(payments.id, id), eq(payments.status, "pending"), available()))
      .returning();
    if (!payment) continue;
    try {
      const kind = await settleSession(await stripe.checkout.sessions.retrieve(payment.stripeSessionId));
      if (kind === "paid" || kind === "expired") report.settled++;
      else {
        report.waiting++;
        const next = kind === "unpaid" ? Date.now() + 30 * 60_000 : Math.min(Math.max(payment.expiresAt.getTime() + 60_000, Date.now() + 5 * 60_000), Date.now() + 60 * 60_000);
        await db.update(payments).set({ recoveryAttempts: 0, recoveryNextAt: new Date(next) }).where(and(eq(payments.id, id), eq(payments.status, "pending")));
      }
    } catch (error) {
      report.failed++;
      const attempts = payment.recoveryAttempts + 1;
      const exhausted = attempts >= MAX_POLL_ERRORS;
      await db
        .update(payments)
        .set({ recoveryAttempts: attempts, recoveryNextAt: new Date(Date.now() + backoffMs(attempts)), ...(exhausted ? { recoveryHold: "exhausted" } : {}) })
        .where(and(eq(payments.id, id), eq(payments.status, "pending")));
      console.error(`Failed to ask Stripe about a pending payment${exhausted ? ", held for review" : ""}`, {
        paymentId: id,
        attempts,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return report;
}

/** What is held for a person, without anything private: why, how often it was tried, and the ids to look it up by. */
export async function heldRecords({ enrollmentId }: { enrollmentId?: string } = {}) {
  const [heldPayments, heldRefunds, failedMails, failedNotifications] = await Promise.all([
    db
      .select({
        id: payments.id,
        enrollmentId: payments.enrollmentId,
        status: payments.status,
        hold: payments.recoveryHold,
        attempts: payments.recoveryAttempts,
        paidAt: payments.paidAt,
        amount: payments.amount,
      })
      .from(payments)
      .where(and(sql`${payments.recoveryHold} is not null`, enrollmentId ? eq(payments.enrollmentId, enrollmentId) : undefined))
      .orderBy(asc(payments.updatedAt))
      .limit(200),
    db
      .select({
        id: refunds.id,
        paymentId: refunds.paymentId,
        enrollmentId: refunds.enrollmentId,
        hold: refunds.recoveryHold,
        attempts: refunds.recoveryAttempts,
        amount: refunds.amount,
        initiatedBy: refunds.initiatedBy,
      })
      .from(refunds)
      .where(and(sql`${refunds.recoveryHold} is not null`, enrollmentId ? eq(refunds.enrollmentId, enrollmentId) : undefined))
      .orderBy(asc(refunds.updatedAt))
      .limit(200),
    db
      .select({ ticketId: ticketMailOutbox.ticketId, attempts: ticketMailOutbox.attempts })
      .from(ticketMailOutbox)
      .where(and(eq(ticketMailOutbox.state, "failed"), enrollmentId ? inArray(ticketMailOutbox.ticketId, db.select({ id: tickets.id }).from(tickets).where(eq(tickets.enrollmentId, enrollmentId))) : undefined))
      .orderBy(asc(ticketMailOutbox.createdAt))
      .limit(200),
    db
      .select({ id: notificationOutbox.id, kind: notificationOutbox.kind, enrollmentId: notificationOutbox.enrollmentId, attempts: notificationOutbox.attempts, lastError: notificationOutbox.lastError })
      .from(notificationOutbox)
      .where(and(eq(notificationOutbox.state, "failed"), enrollmentId ? eq(notificationOutbox.enrollmentId, enrollmentId) : undefined))
      .orderBy(asc(notificationOutbox.createdAt))
      .limit(200),
  ]);
  return { payments: heldPayments, refunds: heldRefunds, mails: failedMails, notifications: failedNotifications };
}

/** Lets recovery try a held payment again, from scratch (once a person has dealt with why it was held: raised the limit, fixed the row). It holds again if the cause is still there. */
export async function resumePayment(paymentId: string) {
  const [row] = await db
    .update(payments)
    .set({ recoveryHold: null, recoveryAttempts: 0, recoveryNextAt: null })
    .where(and(eq(payments.id, paymentId), sql`${payments.recoveryHold} is not null`))
    .returning({ id: payments.id });
  return !!row;
}

export async function resumeRefund(refundId: string) {
  const [row] = await db
    .update(refunds)
    .set({ recoveryHold: null, recoveryAttempts: 0, recoveryNextAt: null })
    .where(and(eq(refunds.id, refundId), sql`${refunds.recoveryHold} is not null`))
    .returning({ id: refunds.id });
  return !!row;
}

/** Runs every repair every minute, one pass at a time, each in its own try so one failing doesn't stop the rest. Returns what stops it (and waits for the pass in progress). */
export function startReconciler({ intervalMs = INTERVAL_MS, only }: { intervalMs?: number; only?: string[] } = {}) {
  let running = false;
  let stopping = false;
  const halt = () => stopping;
  const pass = async () => {
    if (running || stopping) return;
    running = true;
    // mail first (a database and a queue), the steps that wait on Stripe last, so an outage there can't hold the mail up
    const steps = {
      mail: async () => {
        // password-reset mails whose request died between storing the token and recording the mail (all of them: the scan isn't per order)
        if (!only) await recordMissingResetMails();
        const total = { sent: 0, failed: 0, skipped: 0 };
        for (const enrollmentId of only ?? [undefined]) {
          for (const report of [await dispatchTicketMails({ enrollmentId, halt }), await dispatchNotifications({ enrollmentId, halt })]) {
            total.sent += report.sent;
            total.failed += report.failed;
            total.skipped += report.skipped;
          }
        }
        return total;
      },
      paid: () => reconcilePaid({ only, halt }),
      refunds: () => resumeRefunds({ only, halt }),
      pending: () => reconcilePending({ only, halt }),
    };
    try {
      for (const [name, step] of Object.entries(steps)) {
        if (stopping) break;
        try {
          const report = await step();
          if (Object.values(report).some(Boolean)) console.log(`Payment reconciler ${name}`, report);
        } catch (error) {
          console.error(`Payment reconciler ${name} failed`, error);
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(pass, intervalMs);
  void pass();
  // no new pass, and the one in progress stops after the record it is on; resolves once it has
  return async () => {
    stopping = true;
    clearInterval(timer);
    while (running) await Bun.sleep(100);
  };
}
