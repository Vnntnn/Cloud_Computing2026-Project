import {
  and, asc, count, db, desc, enrollments, eq, eventInvitations, events, ilike, or, seatHolds, sql, ticketTypeQuestions,
  tickets, ticketTypes, users, type TicketAnswer,
} from "@app/db";
import type { MailContent, MailOrder } from "@app/mail";
import {
  accountLink, announceSeats, dispatchNotifications, EnrollmentNotFound, invitationTaken, markConfirmed, queueNotifications,
  seatsTaken, sendTicketMails, SoldOut, ticketCode, type Tx,
} from "@app/tickets";
import { enrollableEvent, manages, type Viewer } from "../../libs/access";
import { effectiveStatusSql, loadEnrollments, ticketsOwned } from "../../libs/enrollments";
import {
  EnrollmentNotPending, InvalidAnswers, InvitationUsed, LimitReached, NotInvited, TicketTypeNotFound,
} from "../../libs/errors";
import type * as EnrollmentModel from "./model";

/** How long a first_come or invite payment holds its seats: the 30-minute Checkout session plus slack for the webhook. */
export const PAYMENT_HOLD_MS = 35 * 60_000;
/** How long an approved paid enrollment waits for its payment. */
export const APPROVED_PAYMENT_WINDOW_MS = 72 * 3_600_000;

type QuestionRow = typeof ticketTypeQuestions.$inferSelect;

const SHORT_TEXT_MAX = 200;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/**
 * The tickets the attendees stand for, with their answers checked against the ticket type's
 * questions and copied with their labels; InvalidAnswers if one is missing, too long, not one of
 * a choice's options, or for a question this type doesn't ask.
 */
function toTickets(attendees: EnrollmentModel.AttendeeInput[], questions: QuestionRow[]) {
  const known = new Set(questions.map((question) => question.id));
  const rows = [];
  for (const attendee of attendees) {
    if (attendee.answers.some((answer) => !known.has(answer.questionId))) return new InvalidAnswers();
    const given = new Map(attendee.answers.map((answer) => [answer.questionId, answer.value.trim()]));
    const answers: TicketAnswer[] = [];
    for (const question of questions) {
      const value = given.get(question.id) ?? "";
      if (!value) {
        if (question.required) return new InvalidAnswers();
        continue;
      }
      if (question.type === "short_text" && value.length > SHORT_TEXT_MAX) return new InvalidAnswers();
      if (question.type === "choice" && !question.options?.includes(value)) return new InvalidAnswers();
      answers.push({ questionId: question.id, label: question.label, value });
    }
    rows.push({
      firstName: attendee.firstName.trim(),
      lastName: attendee.lastName.trim(),
      email: attendee.email.trim().toLowerCase(),
      answers,
    });
  }
  return rows;
}

/**
 * Enrolls `buyer` in a ticket type, one ticket per attendee. Everything that limits it (the event
 * being open, the buyer's limit, the seats, the invitation) is checked under a lock on the ticket
 * type row, the same lock its quota edits, seat holds and confirmations take, so concurrent
 * enrollments can't oversell. The buyer's seat hold (routes/holds) makes room for its seats and
 * ends here. Free first_come and invite tickets are confirmed and mailed right away; paid ones
 * wait for payment (apps/payment), approval ones for the organizer.
 */
export async function enroll(buyer: Viewer, input: EnrollmentModel.Post["Body"]) {
  const open = await enrollableEvent(input.ticketTypeId, buyer);
  if (open instanceof Error) return open;
  const { event, invitation } = open;

  const questions = await db
    .select()
    .from(ticketTypeQuestions)
    .where(eq(ticketTypeQuestions.ticketTypeId, input.ticketTypeId))
    .orderBy(asc(ticketTypeQuestions.position));
  const attendees = toTickets(input.attendees, questions);
  if (attendees instanceof Error) return attendees;
  const quantity = attendees.length;

  const created = await db.transaction(async (tx) => {
    const [ticketType] = await tx.select().from(ticketTypes).where(eq(ticketTypes.id, input.ticketTypeId)).for("update");
    if (!ticketType) return new TicketTypeNotFound();

    if ((await ticketsOwned(tx, ticketType.id, buyer.id)) + quantity > ticketType.maxPerUser) return new LimitReached();
    // the buyer's own hold makes room for its seats; a lapsed one counts for nothing, so the buyer
    // then gets whatever seats are still free
    if (
      ticketType.quota !== null &&
      (await seatsTaken(tx, ticketType.id, { holderId: buyer.id })) + quantity > ticketType.quota
    ) {
      return new SoldOut();
    }

    let invitationId: string | null = null;
    if (ticketType.kind === "invite") {
      if (!invitation) return new NotInvited();
      // locked, so it can't be revoked or re-addressed while this enrollment takes it
      const [locked] = await tx
        .select({ usedAt: eventInvitations.usedAt })
        .from(eventInvitations)
        .where(eq(eventInvitations.id, invitation.id))
        .for("update");
      if (!locked) return new NotInvited();
      if (locked.usedAt || (await invitationTaken(tx, invitation.id))) return new InvitationUsed();
      invitationId = invitation.id;
    }

    const paid = Number(ticketType.price) > 0;
    const status = ticketType.kind === "approval" ? "pending" : paid ? "awaiting_payment" : "confirmed";
    const [enrollment] = await tx
      .insert(enrollments)
      .values({
        eventId: event.id,
        ticketTypeId: ticketType.id,
        buyerId: buyer.id,
        quantity,
        unitPrice: ticketType.price,
        status,
        invitationId,
        expiresAt: status === "awaiting_payment" ? new Date(Date.now() + PAYMENT_HOLD_MS) : null,
        // the policy the buyer ordered under; later edits to the event don't change it
        refundPercent: event.isRefundAvailable ? event.refundPercent : null,
        refundCutoffHours: event.isRefundAvailable ? event.refundCutoffHours : null,
      })
      .returning({ id: enrollments.id, invitationId: enrollments.invitationId });
    // uuidv7 ids sort in attendee order; the rows share one created_at
    await tx.insert(tickets).values(
      attendees.map((attendee) => ({ ...attendee, id: Bun.randomUUIDv7(), enrollmentId: enrollment!.id, code: ticketCode() })),
    );
    // the enrollment now holds the seats (awaiting_payment for PAYMENT_HOLD_MS)
    await tx.delete(seatHolds).where(and(eq(seatHolds.ticketTypeId, ticketType.id), eq(seatHolds.holderId, buyer.id)));
    if (status === "confirmed") await markConfirmed(tx, enrollment!);
    return { id: enrollment!.id, confirmed: status === "confirmed" };
  });
  if (created instanceof Error) return created;
  announceSeats(event.id);
  // awaited (at most 10 mails); it never throws
  if (created.confirmed) await sendTicketMails(created.id);
  return getEnrollmentById(created.id);
}

async function getEnrollmentById(enrollmentId: string) {
  const [enrollment] = await loadEnrollments([enrollmentId]);
  return enrollment ?? new EnrollmentNotFound();
}

/** For its buyer, and the event's organizer and admins; anyone else gets a not-found. */
export async function getEnrollment(enrollmentId: string, viewer: Viewer) {
  const [row] = await db
    .select({ buyerId: enrollments.buyerId, organizerId: events.organizerId })
    .from(enrollments)
    .innerJoin(events, eq(events.id, enrollments.eventId))
    .where(eq(enrollments.id, enrollmentId));
  if (!row || (row.buyerId !== viewer.id && !manages(row, viewer))) return new EnrollmentNotFound();
  return getEnrollmentById(enrollmentId);
}

export async function listEventEnrollments(
  eventId: string,
  query: EnrollmentModel.EventsByEventIdEnrollmentsGet["Query"],
) {
  const { page = 1, pageSize = 10 } = query;
  const term = query.q?.trim();
  const pattern = term ? `%${escapeLike(term)}%` : undefined;
  const scope = and(
    eq(enrollments.eventId, eventId),
    query.ticketTypeId ? eq(enrollments.ticketTypeId, query.ticketTypeId) : undefined,
    pattern
      ? or(
          ilike(users.name, pattern),
          ilike(users.email, pattern),
          sql`exists (select 1 from ${tickets} where ${tickets.enrollmentId} = ${enrollments.id} and (${tickets.firstName} || ' ' || ${tickets.lastName} ilike ${pattern} or ${tickets.email} ilike ${pattern}))`,
        )
      : undefined,
  );
  const where = and(scope, query.status ? sql`${effectiveStatusSql} = ${query.status}` : undefined);

  const [rows, byStatus] = await Promise.all([
    db
      .select({ id: enrollments.id })
      .from(enrollments)
      .leftJoin(users, eq(users.id, enrollments.buyerId))
      .where(where)
      .orderBy(desc(enrollments.createdAt), asc(enrollments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ status: effectiveStatusSql, total: count() })
      .from(enrollments)
      .leftJoin(users, eq(users.id, enrollments.buyerId))
      .where(scope)
      .groupBy(effectiveStatusSql),
  ]);
  const counts = { pending: 0, awaiting_payment: 0, confirmed: 0, rejected: 0, expired: 0, cancelled: 0 };
  for (const { status, total } of byStatus) counts[status] = total;
  const total = query.status ? counts[query.status] : byStatus.reduce((sum, row) => sum + row.total, 0);
  return { items: await loadEnrollments(rows.map((row) => row.id)), total, counts };
}

type Buyer = { email: string | null; name: string | null };
type Executor = typeof db | Tx;

async function mailOrder(executor: Executor, enrollmentId: string): Promise<{ buyer: Buyer; order: MailOrder } | undefined> {
  const [row] = await executor
    .select({
      buyerEmail: users.email,
      buyerName: users.name,
      title: events.title,
      venue: events.venue,
      startsAt: events.startsAt,
      ticketType: ticketTypes.name,
      quantity: enrollments.quantity,
    })
    .from(enrollments)
    .innerJoin(events, eq(events.id, enrollments.eventId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, enrollments.ticketTypeId))
    .leftJoin(users, eq(users.id, enrollments.buyerId))
    .where(eq(enrollments.id, enrollmentId));
  if (!row) return undefined;
  return {
    buyer: { email: row.buyerEmail, name: row.buyerName },
    order: {
      event: { title: row.title, venue: row.venue, startsAt: row.startsAt.toISOString() },
      ticketType: row.ticketType,
      quantity: row.quantity,
    },
  };
}

/**
 * Records the mail about the organizer's decision for the buyer, in the transaction that saves the decision (the notification
 * outbox, packages/tickets); it is sent after the commit, and by the payment service's reconciler if a crash comes between.
 */
async function recordDecisionMail(
  tx: Tx,
  enrollmentId: string,
  kind: "enrollment-approved" | "enrollment-rejected",
  compose: (buyer: Buyer, order: MailOrder) => MailContent,
) {
  const found = await mailOrder(tx, enrollmentId);
  if (!found?.buyer.email) return;
  await queueNotifications(tx, [{ key: `${kind}:${enrollmentId}`, kind, enrollmentId, message: { to: found.buyer.email, ...compose(found.buyer, found.order) } }]);
}

/**
 * Approves a pending enrollment. A free one is confirmed and its tickets mailed; a paid one waits
 * for payment (APPROVED_PAYMENT_WINDOW_MS) and the buyer is asked to pay.
 */
export async function approveEnrollment(enrollmentId: string, reviewerId: string) {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).for("update");
    if (!current) return new EnrollmentNotFound();
    if (current.status !== "pending") return new EnrollmentNotPending();
    const paid = Number(current.unitPrice) > 0;
    const expiresAt = new Date(Date.now() + APPROVED_PAYMENT_WINDOW_MS);
    await tx
      .update(enrollments)
      .set({ reviewedBy: reviewerId, reviewedAt: new Date(), ...(paid ? { status: "awaiting_payment", expiresAt } : {}) })
      .where(eq(enrollments.id, enrollmentId));
    // a free one is confirmed (its ticket mails are recorded by markConfirmed); a paid one asks the buyer to pay
    if (!paid) await markConfirmed(tx, current);
    else {
      await recordDecisionMail(tx, enrollmentId, "enrollment-approved", (buyer, order) => ({
        template: "enrollment-approved",
        props: {
          name: buyer.name,
          order,
          payBy: expiresAt.toISOString(),
          url: accountLink(`/tickets/orders/${enrollmentId}`, true),
        },
      }));
    }
    return { paid, expiresAt, eventId: current.eventId };
  });
  if (result instanceof Error) return result;
  announceSeats(result.eventId);

  // the mails owed were recorded with the decision; this sends them (awaited, at most 10; it never throws)
  if (!result.paid) await sendTicketMails(enrollmentId);
  else await dispatchNotifications({ enrollmentId });
  return getEnrollmentById(enrollmentId);
}

export async function rejectEnrollment(enrollmentId: string, reviewerId: string, note: string | undefined) {
  const rejected = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(enrollments)
      .set({ status: "rejected", reviewedBy: reviewerId, reviewedAt: new Date() })
      .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.status, "pending")))
      .returning({ eventId: enrollments.eventId });
    if (!row) return undefined;
    const reason = note?.trim() || null;
    await recordDecisionMail(tx, enrollmentId, "enrollment-rejected", (buyer, order) => ({
      template: "enrollment-rejected",
      props: { name: buyer.name, order, reason },
    }));
    return row;
  });
  if (!rejected) return new EnrollmentNotPending();
  announceSeats(rejected.eventId);
  await dispatchNotifications({ enrollmentId });
  return getEnrollmentById(enrollmentId);
}
