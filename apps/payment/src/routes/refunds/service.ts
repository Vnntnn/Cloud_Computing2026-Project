import { alias, and, asc, count, db, desc, enrollments, eq, events, payments, refunds, sql, ticketTypes, users } from "@app/db";
import { announceSeats, EnrollmentNotFound, refundTerms } from "@app/tickets";
import { HTTPError } from "elysia";
import { RefundUnavailable } from "../../libs/errors";
import { claimRefund, runRefund } from "../../libs/refund";
import type * as RefundModel from "./model";

export class AlreadyRefunded extends HTTPError.id("ALREADY_REFUNDED", 409) {
  override readonly detail = "รายการนี้ยกเลิกและคืนเงินแล้ว";
}

/** Not a confirmed paid order, or (for its buyer) one whose policy gives nothing back. */
export class NotRefundable extends HTTPError.id("NOT_REFUNDABLE", 409) {
  override readonly detail = "รายการนี้ขอคืนเงินไม่ได้";
}

export class RefundClosed extends HTTPError.id("REFUND_CLOSED", 409) {
  override readonly detail = "เลยกำหนดขอคืนเงินของรายการนี้แล้ว";
}

type RefundRow = typeof refunds.$inferSelect;

const toRefund = (refund: RefundRow): RefundModel.Refund => ({
  id: refund.id,
  enrollmentId: refund.enrollmentId,
  amount: Number(refund.amount),
  percent: refund.percent,
  status: refund.status,
  initiatedBy: refund.initiatedBy,
  createdAt: refund.createdAt.toISOString(),
});

type Requester =
  | { initiatedBy: "buyer"; userId: string }
  | { initiatedBy: "organizer"; userId: string; note: string | undefined };

/**
 * Cancels a confirmed, paid order and refunds it: its buyer gets the policy's percent until the
 * deadline, the organizer refunds 100% any time. The enrollment is locked while the checks run and
 * the refund is claimed (libs/refund.ts), so two requests can't both refund it: the second finds the
 * claim and is told it's already refunded. Stripe is asked after the lock is released; the refund,
 * the payment and the cancellation (which frees its seats and invitation) are then recorded together.
 * It's the order's accepted payment that is refunded, never a duplicate of it that is waiting for its own refund.
 */
async function cancelAndRefund(enrollmentId: string, requester: Requester) {
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ enrollment: enrollments, event: { startsAt: events.startsAt } })
      .from(enrollments)
      .innerJoin(events, eq(events.id, enrollments.eventId))
      .where(eq(enrollments.id, enrollmentId))
      .for("update", { of: enrollments });
    if (!row || (requester.initiatedBy === "buyer" && row.enrollment.buyerId !== requester.userId)) {
      return new EnrollmentNotFound();
    }
    const { enrollment } = row;
    if (enrollment.status === "cancelled") return new AlreadyRefunded();
    if (enrollment.status !== "confirmed") return new NotRefundable();

    let percent = 100;
    if (requester.initiatedBy === "buyer") {
      const terms = refundTerms(enrollment, row.event);
      if (!terms) return new NotRefundable();
      if (terms.deadline <= new Date()) return new RefundClosed();
      percent = terms.percent;
    }
    const [payment] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.enrollmentId, enrollmentId),
          eq(payments.status, "paid"),
          // an order confirmed before the accepted payment was recorded: the one paid first
          enrollment.acceptedPaymentId ? eq(payments.id, enrollment.acceptedPaymentId) : undefined,
        ),
      )
      .orderBy(asc(payments.paidAt), asc(payments.id))
      .limit(1)
      .for("update");
    // a free order: nothing to give back
    if (!payment) return new NotRefundable();

    const claim = await claimRefund(tx, payment, {
      percent,
      initiatedBy: requester.initiatedBy,
      requestedBy: requester.userId,
      note: requester.initiatedBy === "organizer" ? requester.note?.trim() || undefined : undefined,
    });
    return { claim, payment, eventId: enrollment.eventId };
  });
  if (claimed instanceof Error) return claimed;

  const outcome = await runRefund(claimed.claim, claimed.payment);
  // its owner is still on it, or it is waiting for its next attempt
  if ("inFlight" in outcome) return outcome.waiting ? new RefundUnavailable() : new AlreadyRefunded();
  if (outcome instanceof Error) return outcome;
  // the cancellation mails were recorded with the refund and sent by the step that recorded it
  if (outcome.performed) announceSeats(claimed.eventId);
  return toRefund(outcome.refund);
}

export const refundAsBuyer = (buyerId: string, enrollmentId: string) =>
  cancelAndRefund(enrollmentId, { initiatedBy: "buyer", userId: buyerId });

export const refundAsOrganizer = (enrollmentId: string, organizerId: string, note: string | undefined) =>
  cancelAndRefund(enrollmentId, { initiatedBy: "organizer", userId: organizerId, note });

const buyers = alias(users, "buyers");
const requesters = alias(users, "requesters");

export async function listEventRefunds(eventId: string, query: RefundModel.EventsByEventIdRefundsGet["Query"]) {
  const { page = 1, pageSize = 10 } = query;
  const scope = eq(enrollments.eventId, eventId);
  const [rows, byStatus] = await Promise.all([
    db
      .select({
        refund: refunds,
        quantity: enrollments.quantity,
        unitPrice: enrollments.unitPrice,
        ticketType: { id: ticketTypes.id, name: ticketTypes.name, kind: ticketTypes.kind },
        buyer: { id: buyers.id, name: buyers.name, email: buyers.email },
        requester: { name: requesters.name },
      })
      .from(refunds)
      .innerJoin(enrollments, eq(enrollments.id, refunds.enrollmentId))
      .innerJoin(ticketTypes, eq(ticketTypes.id, enrollments.ticketTypeId))
      .leftJoin(buyers, eq(buyers.id, enrollments.buyerId))
      .leftJoin(requesters, eq(requesters.id, refunds.requestedBy))
      .where(and(scope, query.status ? eq(refunds.status, query.status) : undefined))
      .orderBy(desc(refunds.createdAt), desc(refunds.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        status: refunds.status,
        total: count(),
        amount: sql<number>`coalesce(sum(${refunds.amount}), 0)`.mapWith(Number),
      })
      .from(refunds)
      .innerJoin(enrollments, eq(enrollments.id, refunds.enrollmentId))
      .where(scope)
      .groupBy(refunds.status),
  ]);

  const counts = { pending: 0, requires_action: 0, succeeded: 0, failed: 0, canceled: 0 };
  let refundedTotal = 0;
  for (const { status, total, amount } of byStatus) {
    counts[status] = total;
    if (status !== "failed" && status !== "canceled") refundedTotal += amount;
  }
  return {
    items: rows.map(
      (row): RefundModel.EventRefund => ({
        ...toRefund(row.refund),
        note: row.refund.note,
        failureReason: row.refund.failureReason,
        quantity: row.quantity,
        orderTotal: Number(row.unitPrice) * row.quantity,
        ticketType: row.ticketType,
        buyer: row.buyer,
        requester: row.requester,
      }),
    ),
    total: query.status ? counts[query.status] : byStatus.reduce((sum, row) => sum + row.total, 0),
    counts,
    refundedTotal: Math.round(refundedTotal * 100) / 100,
  };
}
