import { and, asc, db, enrollments, OUTBOX_CHUNK, OUTBOX_LEASE_MS, OUTBOX_MAX_ATTEMPTS, outboxBackoffMs, eq, events, inArray, isNull, lte, or, sql, ticketMailOutbox, tickets, ticketTypes } from "@app/db";
import { enqueueMail } from "@app/mail";
import { accountLink, registeredEmails } from "./mail";

// A ticket mail is owed from the moment the order is confirmed (markConfirmed records it in that transaction) until the
// queue has it. It is sent right after the confirming request commits, and by whoever calls dispatchTicketMails on a timer
// (apps/payment's reconciler), so a crash in between only delays it. The queue and the mail worker are at-least-once, and so
// is this: a crash after the queue took the message but before `sent` is recorded sends it again once the lease runs out.
const LEASE_MS = OUTBOX_LEASE_MS;
const MAX_ATTEMPTS = OUTBOX_MAX_ATTEMPTS;
const backoffMs = outboxBackoffMs;

const due = () => or(isNull(ticketMailOutbox.nextAttemptAt), lte(ticketMailOutbox.nextAttemptAt, new Date()));

/**
 * Sends the ticket mails that are owed (all of them, oldest first, at most `limit`; or those of one enrollment). Each is
 * taken with a lease first, so concurrent callers never send the same one. One whose order is no longer confirmed is skipped,
 * one the queue refuses is retried with backoff and marked failed after MAX_ATTEMPTS. Never throws.
 */
export async function dispatchTicketMails({ enrollmentId, limit = 50, halt }: { enrollmentId?: string; limit?: number; halt?: () => boolean } = {}) {
  const report = { sent: 0, failed: 0, skipped: 0 };
  try {
    const owed = await db
      .select({ ticketId: ticketMailOutbox.ticketId })
      .from(ticketMailOutbox)
      .innerJoin(tickets, eq(tickets.id, ticketMailOutbox.ticketId))
      .where(and(eq(ticketMailOutbox.state, "pending"), due(), enrollmentId ? eq(tickets.enrollmentId, enrollmentId) : undefined))
      .orderBy(asc(ticketMailOutbox.createdAt))
      .limit(limit);

    const deliver = async (ticketId: string) => {
      const [claimed] = await db
        .update(ticketMailOutbox)
        .set({ attempts: sql`${ticketMailOutbox.attempts} + 1`, nextAttemptAt: new Date(Date.now() + LEASE_MS), lastAttemptAt: new Date(), lastError: null })
        .where(and(eq(ticketMailOutbox.ticketId, ticketId), eq(ticketMailOutbox.state, "pending"), due()))
        .returning({ attempts: ticketMailOutbox.attempts });
      if (!claimed) return "lost" as const;
      try {
        const sent = await sendOne(ticketId);
        await db
          .update(ticketMailOutbox)
          .set(sent ? { state: "sent", sentAt: new Date(), nextAttemptAt: null } : { state: "skipped", nextAttemptAt: null })
          .where(eq(ticketMailOutbox.ticketId, ticketId));
        return sent ? ("sent" as const) : ("skipped" as const);
      } catch (error) {
        const name = error instanceof Error ? error.name : "unknown";
        const giveUp = claimed.attempts >= MAX_ATTEMPTS;
        await db
          .update(ticketMailOutbox)
          .set(giveUp ? { state: "failed", nextAttemptAt: null, lastError: name } : { nextAttemptAt: new Date(Date.now() + backoffMs(claimed.attempts)), lastError: name })
          .where(eq(ticketMailOutbox.ticketId, ticketId));
        console.error(`Failed to send a ticket mail (attempt ${claimed.attempts}${giveUp ? ", giving up" : ""})`, { ticketId, error: name });
        return "failed" as const;
      }
    };

    // ten at a time, and no further once a whole chunk failed (the queue is down): one send timeout per call, not one per ticket
    for (let i = 0; i < owed.length; i += OUTBOX_CHUNK) {
      if (halt?.()) break;
      const results = await Promise.all(owed.slice(i, i + OUTBOX_CHUNK).map(({ ticketId }) => deliver(ticketId)));
      for (const result of results) if (result !== "lost") report[result]++;
      if (results.every((result) => result === "failed")) break;
    }
  } catch (error) {
    console.error("Failed to send ticket mail", error instanceof Error ? error.name : "unknown");
  }
  return report;
}

/** Emails every attendee of a just-confirmed enrollment their ticket (what its transaction owes). Never throws. */
export const sendTicketMails = (enrollmentId: string) => dispatchTicketMails({ enrollmentId });

/** The mail of one ticket: false when its order isn't confirmed, so nothing is owed. The ticket page needs an account with the ticket's email, so attendees without one are sent to sign up first. */
async function sendOne(ticketId: string) {
  const [row] = await db
    .select({
      ticket: tickets,
      status: enrollments.status,
      title: events.title,
      venue: events.venue,
      startsAt: events.startsAt,
      ticketType: ticketTypes.name,
    })
    .from(tickets)
    .innerJoin(enrollments, eq(enrollments.id, tickets.enrollmentId))
    .innerJoin(events, eq(events.id, enrollments.eventId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, enrollments.ticketTypeId))
    .where(eq(tickets.id, ticketId));
  if (!row || row.status !== "confirmed") return false;
  const { ticket } = row;
  const hasAccount = (await registeredEmails([ticket.email])).has(ticket.email);
  await enqueueMail({
    to: ticket.email,
    template: "ticket",
    props: {
      name: `${ticket.firstName} ${ticket.lastName}`,
      email: ticket.email,
      ticketType: row.ticketType,
      event: { title: row.title, venue: row.venue, startsAt: row.startsAt.toISOString() },
      code: ticket.code,
      url: accountLink(`/tickets/${ticket.id}`, hasAccount),
      hasAccount,
    },
  });
  return true;
}

/** Lets mails that gave up (`failed`) be sent again, from scratch (all of them, or one order's): for after what stopped them (the queue, its credentials) is fixed. Returns how many. */
export async function resumeTicketMails({ enrollmentId }: { enrollmentId?: string } = {}) {
  const resumed = await db
    .update(ticketMailOutbox)
    .set({ state: "pending", attempts: 0, nextAttemptAt: null, lastError: null })
    .where(and(eq(ticketMailOutbox.state, "failed"), enrollmentId ? inArray(ticketMailOutbox.ticketId, db.select({ id: tickets.id }).from(tickets).where(eq(tickets.enrollmentId, enrollmentId))) : undefined))
    .returning({ ticketId: ticketMailOutbox.ticketId });
  return resumed.length;
}
