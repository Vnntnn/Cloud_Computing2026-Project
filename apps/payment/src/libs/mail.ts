import { db, enrollments, eq, events, refunds, tickets, ticketTypes, users } from "@app/db";
import type { MailOrder } from "@app/mail";
import { accountLink, type Notification, type Tx } from "@app/tickets";

// The mails that follow a refund, composed from what the database says at the time (the caller's transaction, so what it has
// just written is seen) and handed to the notification outbox with the change itself (packages/tickets notifications.ts).

type RefundRow = typeof refunds.$inferSelect;
type Executor = typeof db | Tx;

async function orderOf(executor: Executor, enrollmentId: string) {
  const [row] = await executor
    .select({
      buyerEmail: users.email,
      buyerName: users.name,
      title: events.title,
      venue: events.venue,
      startsAt: events.startsAt,
      ticketType: ticketTypes.name,
      quantity: enrollments.quantity,
      unitPrice: enrollments.unitPrice,
    })
    .from(enrollments)
    .innerJoin(events, eq(events.id, enrollments.eventId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, enrollments.ticketTypeId))
    .leftJoin(users, eq(users.id, enrollments.buyerId))
    .where(eq(enrollments.id, enrollmentId));
  if (!row) return undefined;
  const order: MailOrder = {
    event: { title: row.title, venue: row.venue, startsAt: row.startsAt.toISOString() },
    ticketType: row.ticketType,
    quantity: row.quantity,
  };
  return { buyerEmail: row.buyerEmail, buyerName: row.buyerName, total: Number(row.unitPrice) * row.quantity, order };
}

const ordersPage = (enrollmentId: string) => accountLink(`/tickets/orders/${enrollmentId}`, true);

/**
 * A payment the system refunded in full, for the reason in the refund's note: it landed after its
 * hold lapsed and the seats went (unavailable), or it paid for the order a second time (duplicate).
 */
export async function composeSystemRefund(executor: Executor, refund: RefundRow): Promise<Notification[]> {
  const found = await orderOf(executor, refund.enrollmentId);
  if (!found?.buyerEmail) return [];
  return [
    {
      key: `refund-system:${refund.id}`,
      kind: "refund-system",
      enrollmentId: refund.enrollmentId,
      refundId: refund.id,
      message: {
        to: found.buyerEmail,
        template: "refund-system",
        props: {
          name: found.buyerName,
          reason: refund.note === "duplicate" ? "duplicate" : "unavailable",
          order: found.order,
          amount: Number(refund.amount),
          manual: refund.stripeRefundId === null,
          orderNumber: refund.enrollmentId,
        },
      },
    },
  ];
}

/**
 * Tells the buyer their order was cancelled and what comes back, and every other attendee that
 * their ticket no longer works.
 */
export async function composeCancellation(executor: Executor, refund: RefundRow): Promise<Notification[]> {
  const found = await orderOf(executor, refund.enrollmentId);
  if (!found) return [];
  const base = { enrollmentId: refund.enrollmentId, refundId: refund.id };
  const notes: Notification[] = [];

  if (found.buyerEmail) {
    notes.push({
      ...base,
      key: `order-cancelled:${refund.id}`,
      kind: "order-cancelled",
      message: {
        to: found.buyerEmail,
        template: "order-cancelled",
        props: {
          name: found.buyerName,
          byOrganizer: refund.initiatedBy === "organizer",
          note: refund.note,
          order: found.order,
          amount: Number(refund.amount),
          percent: refund.percent,
          total: found.total,
          manual: refund.stripeRefundId === null,
          orderNumber: refund.enrollmentId,
          url: ordersPage(refund.enrollmentId),
        },
      },
    });
  }

  const attendees = await executor
    .select({ email: tickets.email, firstName: tickets.firstName, lastName: tickets.lastName })
    .from(tickets)
    .where(eq(tickets.enrollmentId, refund.enrollmentId));
  const notified = new Set([found.buyerEmail]);
  for (const attendee of attendees) {
    if (notified.has(attendee.email)) continue;
    notified.add(attendee.email);
    notes.push({
      ...base,
      key: `ticket-cancelled:${refund.id}:${attendee.email}`,
      kind: "ticket-cancelled",
      message: {
        to: attendee.email,
        template: "ticket-cancelled",
        props: { name: `${attendee.firstName} ${attendee.lastName}`, buyerName: found.buyerName, order: found.order },
      },
    });
  }
  return notes;
}

/** Stripe couldn't return the money (it's back in the Stripe balance). */
export async function composeRefundFailed(executor: Executor, refund: RefundRow): Promise<Notification[]> {
  const found = await orderOf(executor, refund.enrollmentId);
  if (!found?.buyerEmail) return [];
  return [
    {
      key: `refund-failed:${refund.id}`,
      kind: "refund-failed",
      enrollmentId: refund.enrollmentId,
      refundId: refund.id,
      message: {
        to: found.buyerEmail,
        template: "refund-failed",
        props: { name: found.buyerName, order: found.order, amount: Number(refund.amount), url: ordersPage(refund.enrollmentId) },
      },
    },
  ];
}

/** Stripe cancelled the refund: the money was not returned, and (unlike a failure) nothing said why. */
export async function composeRefundCanceled(executor: Executor, refund: RefundRow): Promise<Notification[]> {
  const found = await orderOf(executor, refund.enrollmentId);
  if (!found?.buyerEmail) return [];
  return [
    {
      key: `refund-canceled:${refund.id}`,
      kind: "refund-canceled",
      enrollmentId: refund.enrollmentId,
      refundId: refund.id,
      message: {
        to: found.buyerEmail,
        template: "refund-canceled",
        props: { name: found.buyerName, order: found.order, amount: Number(refund.amount), url: ordersPage(refund.enrollmentId) },
      },
    },
  ];
}
