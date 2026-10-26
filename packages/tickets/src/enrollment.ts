import { and, db, enrollments, eq, eventInvitations, gt, inArray, ne, or, seatHolds, sql, ticketMailOutbox, tickets, ticketTypes } from "@app/db";
import { AnotherPaymentAccepted, EnrollmentClosed, EnrollmentNotFound, OverLimit, SoldOut } from "./errors";
import { announceSeats } from "./seats";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

type EnrollmentRow = typeof enrollments.$inferSelect;

/**
 * An enrollment that holds its tickets: confirmed, waiting for the organizer, or a payment hold
 * that hasn't run out. A lapsed hold stops counting right away, so its seats free up without a job;
 * the payment service flips its status to `expired` later.
 */
export const activeEnrollment = () =>
  or(
    inArray(enrollments.status, ["confirmed", "pending"]),
    and(eq(enrollments.status, "awaiting_payment"), gt(enrollments.expiresAt, sql`now()`)),
  );

/** `awaiting_payment` past its hold reads as `expired`, whether or not the webhook has said so yet. */
export const effectiveStatus = (enrollment: Pick<EnrollmentRow, "status" | "expiresAt">) =>
  enrollment.status === "awaiting_payment" && enrollment.expiresAt && enrollment.expiresAt <= new Date()
    ? "expired"
    : enrollment.status;

/** A seat hold that hasn't run out. Like a payment hold, a lapsed one stops counting right away, without a job. */
export const activeHold = () => gt(seatHolds.expiresAt, sql`now()`);

/**
 * Tickets the active enrollments of a ticket type hold, plus the seats accounts hold while they
 * fill in the enroll form. `except` leaves out an enrollment that is checked again, or the hold of
 * the account that enrolls with it. Writers that check it against the quota lock the ticket type
 * row first (`SELECT … FOR UPDATE`), so two enrollments can't both take the last seat.
 */
export async function seatsTaken(
  executor: Executor,
  ticketTypeId: string,
  except: { enrollmentId?: string; holderId?: string } = {},
) {
  const [enrolled] = await executor
    .select({ total: sql<number>`coalesce(sum(${enrollments.quantity}), 0)`.mapWith(Number) })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.ticketTypeId, ticketTypeId),
        activeEnrollment(),
        except.enrollmentId ? ne(enrollments.id, except.enrollmentId) : undefined,
      ),
    );
  const [held] = await executor
    .select({ total: sql<number>`coalesce(sum(${seatHolds.quantity}), 0)`.mapWith(Number) })
    .from(seatHolds)
    .where(
      and(
        eq(seatHolds.ticketTypeId, ticketTypeId),
        activeHold(),
        except.holderId ? ne(seatHolds.holderId, except.holderId) : undefined,
      ),
    );
  return (enrolled?.total ?? 0) + (held?.total ?? 0);
}

/** Whether another active enrollment already uses the invitation (it allows one). */
export async function invitationTaken(executor: Executor, invitationId: string, exceptEnrollmentId?: string) {
  const [row] = await executor
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.invitationId, invitationId),
        activeEnrollment(),
        exceptEnrollmentId ? ne(enrollments.id, exceptEnrollmentId) : undefined,
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Marks an enrollment confirmed and uses up its invitation. `paymentId` is the payment that confirmed it (none for a free
 * or approved-free order). The mail owed to each attendee is recorded here, in the confirming transaction, and sent after it
 * (outbox.ts), so confirming and owing the mail can't be separated by a crash. Run it in the transaction that locked the enrollment.
 */
export async function markConfirmed(tx: Tx, enrollment: Pick<EnrollmentRow, "id" | "invitationId">, paymentId?: string) {
  const now = new Date();
  await tx
    .update(enrollments)
    .set({ status: "confirmed", confirmedAt: now, expiresAt: null, ...(paymentId ? { acceptedPaymentId: paymentId } : {}) })
    .where(eq(enrollments.id, enrollment.id));
  if (enrollment.invitationId) {
    await tx.update(eventInvitations).set({ usedAt: now }).where(eq(eventInvitations.id, enrollment.invitationId));
  }
  const owed = await tx.select({ ticketId: tickets.id }).from(tickets).where(eq(tickets.enrollmentId, enrollment.id));
  if (owed.length) await tx.insert(ticketMailOutbox).values(owed).onConflictDoNothing();
}

/**
 * Cancels a refunded enrollment. It stops holding its seats and its invitation, which the invitee
 * may use again. Run it in the transaction that locked the enrollment.
 */
export async function markCancelled(tx: Tx, enrollment: Pick<EnrollmentRow, "id" | "invitationId">) {
  await tx
    .update(enrollments)
    .set({ status: "cancelled", cancelledAt: new Date(), expiresAt: null })
    .where(eq(enrollments.id, enrollment.id));
  if (enrollment.invitationId) {
    await tx.update(eventInvitations).set({ usedAt: null }).where(eq(eventInvitations.id, enrollment.invitationId));
  }
}

/**
 * Confirms a pending (approved) or paid enrollment. A first_come or invite enrollment whose hold
 * ran out no longer owns its seats or invitation, so it's confirmed only if they're still free;
 * otherwise `SoldOut` (the payment service then refunds); and only if the buyer's other active orders
 * leave room under `max_per_user`, otherwise `OverLimit` (the payment service holds it for a person).
 * Approval tickets have no seats to protect.
 * `alreadyConfirmed` makes a repeated call (e.g. a webhook delivered twice) a no-op; `paymentId` is recorded as the accepted payment,
 * and a call with another payment for an order already confirmed by one is `AnotherPaymentAccepted`. A new
 * confirmation is announced to the live seat feed.
 */
export async function confirmEnrollment(enrollmentId: string, paymentId?: string) {
  const result = await db.transaction(async (tx) => {
    const [enrollment] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).for("update");
    if (!enrollment) return new EnrollmentNotFound();
    if (enrollment.status === "confirmed") {
      // confirmed by another payment: this one is the duplicate (an order confirmed before accepted_payment_id existed keeps the old behaviour)
      if (paymentId && enrollment.acceptedPaymentId && enrollment.acceptedPaymentId !== paymentId) return new AnotherPaymentAccepted();
      return { alreadyConfirmed: true as const };
    }
    // a cancelled order stays cancelled; a payment that still lands for it is refunded
    if (enrollment.status === "rejected" || enrollment.status === "cancelled") return new EnrollmentClosed();

    // the same lock the registration service takes before counting seats
    const [ticketType] = await tx
      .select({ kind: ticketTypes.kind, quota: ticketTypes.quota, maxPerUser: ticketTypes.maxPerUser })
      .from(ticketTypes)
      .where(eq(ticketTypes.id, enrollment.ticketTypeId))
      .for("update");
    const lapsed = effectiveStatus(enrollment) === "expired";
    if (lapsed && ticketType?.kind !== "approval") {
      // the buyer may have ordered again since, and a lapsed order no longer counts against `max_per_user`
      if (ticketType && enrollment.buyerId) {
        const [owned] = await tx
          .select({ total: sql<number>`coalesce(sum(${enrollments.quantity}), 0)`.mapWith(Number) })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.ticketTypeId, enrollment.ticketTypeId),
              eq(enrollments.buyerId, enrollment.buyerId),
              activeEnrollment(),
              ne(enrollments.id, enrollment.id),
            ),
          );
        if ((owned?.total ?? 0) + enrollment.quantity > ticketType.maxPerUser) return new OverLimit();
      }
      if (ticketType?.quota != null) {
        const taken = await seatsTaken(tx, enrollment.ticketTypeId, { enrollmentId: enrollment.id });
        if (taken + enrollment.quantity > ticketType.quota) return new SoldOut();
      }
      if (enrollment.invitationId && (await invitationTaken(tx, enrollment.invitationId, enrollment.id))) {
        return new SoldOut();
      }
    }
    await markConfirmed(tx, enrollment, paymentId);
    return { alreadyConfirmed: false as const, eventId: enrollment.eventId };
  });
  if (!(result instanceof Error) && !result.alreadyConfirmed) announceSeats(result.eventId);
  return result;
}
