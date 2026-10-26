import { and, db, desc, enrollments, eq, events, gt, payments, ticketTypes } from "@app/db";
import { appUrl, effectiveStatus, EnrollmentClosed, EnrollmentNotFound } from "@app/tickets";
import { HTTPError } from "elysia";
import { recoverPaid, settleSession } from "../../libs/settle";
import { stripe } from "../../libs/stripe";

export class AlreadyPaid extends HTTPError.id("ALREADY_PAID", 409) {
  override readonly detail = "รายการนี้ชำระเงินแล้ว";
}

export class NotPayable extends HTTPError.id("NOT_PAYABLE", 409) {
  override readonly detail = "รายการนี้ยังไม่ต้องชำระเงิน";
}

export class PaymentUnavailable extends HTTPError.id("PAYMENT_UNAVAILABLE", 503) {
  override readonly detail = "ระบบชำระเงินขัดข้อง กรุณาลองใหม่อีกครั้ง";
}

const MINUTE = 60_000;
// Stripe takes 30 minutes to 24 hours; a minute more absorbs clock skew
const MIN_SESSION_MS = 31 * MINUTE;
const MAX_SESSION_MS = 24 * 60 * MINUTE;
// an open session this close to expiring isn't worth reusing
const REUSE_MARGIN_MS = 2 * MINUTE;

/**
 * The Stripe Checkout page for the buyer's enrollment that waits for payment. An open session is
 * reused, so the buyer never pays twice; the enrollment row stays locked while a new one is made.
 * A first_come or invite session ends with the seat hold (the enrollment was made just before);
 * an approval one ends at the payment deadline, within Stripe's 24 hours.
 * A payment that still lands after its hold lapsed is checked again by the webhook.
 */
export async function createCheckout(buyer: { id: string; email: string }, enrollmentId: string) {
  // a session that ended but wasn't settled would be reused, and Stripe shows "You're all done here"
  const synced = await syncPayments(buyer.id, enrollmentId);
  if (synced) return synced;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        enrollment: enrollments,
        event: { title: events.title },
        ticketType: { name: ticketTypes.name, kind: ticketTypes.kind },
      })
      .from(enrollments)
      .innerJoin(events, eq(events.id, enrollments.eventId))
      .innerJoin(ticketTypes, eq(ticketTypes.id, enrollments.ticketTypeId))
      .where(eq(enrollments.id, enrollmentId))
      .for("update", { of: enrollments });
    if (!row || row.enrollment.buyerId !== buyer.id) return new EnrollmentNotFound();
    const { enrollment } = row;
    const status = effectiveStatus(enrollment);
    if (status === "confirmed") return new AlreadyPaid();
    if (status === "pending") return new NotPayable();
    if (status !== "awaiting_payment") return new EnrollmentClosed();

    const now = Date.now();
    const [open] = await tx
      .select({ checkoutUrl: payments.checkoutUrl })
      .from(payments)
      .where(
        and(
          eq(payments.enrollmentId, enrollmentId),
          eq(payments.status, "pending"),
          gt(payments.expiresAt, new Date(now + REUSE_MARGIN_MS)),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (open) return { url: open.checkoutUrl };

    const deadline = row.ticketType.kind === "approval" ? enrollment.expiresAt!.getTime() : now;
    const expiresAt = new Date(Math.min(Math.max(deadline, now + MIN_SESSION_MS), now + MAX_SESSION_MS));
    const unitPrice = Number(enrollment.unitPrice);
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            quantity: enrollment.quantity,
            price_data: {
              currency: "thb",
              // satang
              unit_amount: Math.round(unitPrice * 100),
              product_data: { name: `${row.event.title} — ${row.ticketType.name}` },
            },
          },
        ],
        client_reference_id: enrollmentId,
        metadata: { enrollmentId },
        customer_email: buyer.email,
        success_url: `${appUrl}/tickets/orders/${enrollmentId}?paid=1`,
        cancel_url: `${appUrl}/tickets/orders/${enrollmentId}`,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
      });
    } catch (error) {
      console.error("Failed to create a Stripe Checkout session", error);
      return new PaymentUnavailable();
    }
    if (!session.url) return new PaymentUnavailable();

    await tx.insert(payments).values({
      enrollmentId,
      stripeSessionId: session.id,
      checkoutUrl: session.url,
      amount: (unitPrice * enrollment.quantity).toFixed(2),
      expiresAt,
    });
    return { url: session.url };
  });
}

/**
 * The buyer's "check payment": settles what Stripe already knows about the enrollment's sessions,
 * then answers its status.
 */
export async function verifyPayment(buyerId: string, enrollmentId: string) {
  const synced = await syncPayments(buyerId, enrollmentId);
  if (synced) return synced;

  const [enrollment] = await db
    .select({ buyerId: enrollments.buyerId, status: enrollments.status, expiresAt: enrollments.expiresAt })
    .from(enrollments)
    .where(eq(enrollments.id, enrollmentId));
  if (!enrollment || enrollment.buyerId !== buyerId) return new EnrollmentNotFound();
  return { status: effectiveStatus(enrollment) };
}

/**
 * Asks Stripe how the buyer's pending sessions for the enrollment ended and settles them as the
 * webhook would, for when its event never arrived (e.g. `stripe listen` wasn't running). Whichever
 * comes first claims the payment; the other is a no-op. An open session stays pending, and so does
 * one completed with a delayed method that hasn't paid yet (the webhook still settles that).
 */
async function syncPayments(buyerId: string, enrollmentId: string) {
  const pending = await db
    .select({ sessionId: payments.stripeSessionId })
    .from(payments)
    .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
    .where(and(eq(payments.enrollmentId, enrollmentId), eq(enrollments.buyerId, buyerId), eq(payments.status, "pending")));
  try {
    for (const { sessionId } of pending) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      await settleSession(session);
    }
    // a payment claimed as paid by a process that died before confirming the order
    await recoverPaid(buyerId, enrollmentId);
  } catch (error) {
    console.error("Failed to sync a Stripe Checkout session", error);
    return new PaymentUnavailable();
  }
}
