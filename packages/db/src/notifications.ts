import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "./index";
import {
  enrollments, eventInvitations, events, notificationOutbox, organizerApplications, refunds, ticketMailOutbox, tickets, users, verifications,
} from "./schema";

// The outbox's delivery, shared by every service that mails after a state change (payment, registration, event, auth). A mail is
// recorded in the transaction that makes the change (queueNotifications), sent after the commit by whoever calls
// dispatchNotifications (with the queue's `send`), leased, retried with backoff, `failed` after MAX_ATTEMPTS, at least once.
// The ticket mails have their own table (packages/tickets) and the same policy.

export const OUTBOX_LEASE_MS = 5 * 60_000;
export const OUTBOX_MAX_ATTEMPTS = 8;
export const outboxBackoffMs = (attempts: number) => Math.min(2 ** attempts * 30_000, 30 * 60_000);

export type NotificationKind =
  | "refund-system"
  | "order-cancelled"
  | "ticket-cancelled"
  | "refund-failed"
  | "refund-canceled"
  | "enrollment-approved"
  | "enrollment-rejected"
  | "organizer-approved"
  | "organizer-rejected"
  | "event-invitation"
  | "reset-password"
  | "epoch";

export type Notification = {
  // names the logical mail, so recording it twice (a step that runs again) is one mail
  key: string;
  kind: NotificationKind;
  enrollmentId?: string;
  refundId?: string;
  subjectId?: string;
  // null: composed when sent (reset-password)
  message: unknown;
};

type Executor = Pick<typeof db, "insert">;
type Send = (message: any) => Promise<void>;

/** Records the mails owed for a change, in the transaction that makes it. */
export async function queueNotifications(tx: Executor, notifications: Notification[]) {
  if (notifications.length === 0) return;
  await tx
    .insert(notificationOutbox)
    .values(
      notifications.map((n) => ({
        dedupeKey: n.key,
        kind: n.kind,
        enrollmentId: n.enrollmentId ?? null,
        refundId: n.refundId ?? null,
        subjectId: n.subjectId ?? null,
        message: n.message ?? null,
      })),
    )
    .onConflictDoNothing({ target: notificationOutbox.dedupeKey });
}

type Owed = typeof notificationOutbox.$inferSelect;

const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";

/**
 * What to send, looked at again when it is about to be sent: the message, or null when the state the mail talks about no longer
 * holds (a stale mail would mislead, or, for a reset link, be sent for a token that is gone). A mail with no stored message is
 * composed here, from the state itself, so no secret is ever copied into the outbox.
 */
async function messageToSend(row: Owed): Promise<unknown | null> {
  switch (row.kind as NotificationKind) {
    case "reset-password": {
      if (!row.subjectId) return null;
      const [found] = await db
        .select({ identifier: verifications.identifier, expiresAt: verifications.expiresAt, email: users.email })
        .from(verifications)
        // better-auth stores the user id as text
        .innerJoin(users, sql`${users.id}::text = ${verifications.value}`)
        .where(eq(verifications.id, row.subjectId));
      // the token is spent (a password was set), expired, or gone: nobody is owed this link
      if (!found || found.expiresAt <= new Date() || !found.identifier.startsWith("reset-password:")) return null;
      const token = found.identifier.slice("reset-password:".length);
      const callback = encodeURIComponent(`${appUrl}/reset-password`);
      return { to: found.email, template: "reset-password", props: { url: `${appUrl}/api/auth/reset-password/${token}?callbackURL=${callback}` } };
    }
    case "organizer-approved":
    case "organizer-rejected": {
      if (!row.subjectId) return null;
      const [application] = await db.select({ status: organizerApplications.status }).from(organizerApplications).where(eq(organizerApplications.id, row.subjectId));
      return application?.status === (row.kind === "organizer-approved" ? "approved" : "rejected") ? row.message : null;
    }
    case "event-invitation": {
      if (!row.subjectId) return null;
      // revoked (the row is gone), or the event is no longer invite-only (a draft's invitees would only reach a page they can't open)
      const [invitation] = await db
        .select({ status: events.status, email: eventInvitations.email, notifiedAt: eventInvitations.notifiedAt })
        .from(eventInvitations)
        .innerJoin(events, eq(events.id, eventInvitations.eventId))
        .where(eq(eventInvitations.id, row.subjectId));
      const to = (row.message as { to?: string } | null)?.to;
      if (invitation && invitation.status !== "invite" && invitation.email === to) {
        // not mailed after all: the event went back to a draft. Unclaim it, so that switching to invite-only mails it then
        await db.update(eventInvitations).set({ notifiedAt: null }).where(and(eq(eventInvitations.id, row.subjectId), eq(eventInvitations.email, to)));
        return null;
      }
      // still addressed to the person the mail was written for, and this is the mail of the latest claim (an invitation re-addressed
      // and back again has its older mails closed, so the invitee gets one)
      const latest = !!invitation?.notifiedAt && row.dedupeKey.endsWith(`:${invitation.notifiedAt.getTime()}`);
      return invitation?.status === "invite" && invitation.email === to && latest ? row.message : null;
    }
    default:
      return (await orderMailStillOwed(row)) ? row.message : null;
  }
}

async function orderMailStillOwed(row: Owed) {
  if (!row.enrollmentId) return false;
  const [enrollment] = await db
    .select({ status: enrollments.status, expiresAt: enrollments.expiresAt })
    .from(enrollments)
    .where(eq(enrollments.id, row.enrollmentId));
  if (!enrollment) return false;
  switch (row.kind as NotificationKind) {
    case "enrollment-approved":
      // asks the buyer to pay by a date: only while the order still waits for that
      return enrollment.status === "awaiting_payment" && (!enrollment.expiresAt || enrollment.expiresAt > new Date());
    case "enrollment-rejected":
      return enrollment.status === "rejected";
    case "ticket-cancelled":
      return enrollment.status === "cancelled";
    case "order-cancelled":
    case "refund-system":
    case "refund-failed":
    case "refund-canceled": {
      if (!row.refundId) return false;
      if (row.kind === "order-cancelled" && enrollment.status !== "cancelled") return false;
      const [refund] = await db.select({ status: refunds.status }).from(refunds).where(eq(refunds.id, row.refundId));
      if (!refund) return false;
      if (row.kind === "refund-failed") return refund.status === "failed";
      if (row.kind === "refund-canceled") return refund.status === "canceled";
      // "your money is coming back" is no longer true once the refund has failed or been cancelled
      return refund.status !== "failed" && refund.status !== "canceled";
    }
    default:
      return false;
  }
}

const due = () => or(isNull(notificationOutbox.nextAttemptAt), lte(notificationOutbox.nextAttemptAt, new Date()));

type Scope = { enrollmentId?: string; subjectId?: string; subjectIds?: string[]; limit?: number; halt?: () => boolean };

// Sent ten at a time, and no further once every send of a chunk failed (the queue is down: the rest stay due for the next call), so a
// queue that never answers costs one send timeout per call, not one per mail.
export const OUTBOX_CHUNK = 10;

/**
 * Sends the mails that are owed (oldest first, at most `limit`; or those of one order or subject), each taken with a lease first.
 * `send` is the queue. A failure is logged by kind, id and error name only: never the message, which can carry a link. `halt`
 * is asked between chunks (a shutdown). Never throws.
 */
export async function dispatchNotifications(send: Send, { enrollmentId, subjectId, subjectIds, limit = 50, halt }: Scope = {}) {
  const report = { sent: 0, failed: 0, skipped: 0 };
  try {
    const owed = await db
      .select({ id: notificationOutbox.id })
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.state, "pending"),
          due(),
          enrollmentId ? eq(notificationOutbox.enrollmentId, enrollmentId) : undefined,
          subjectId ? eq(notificationOutbox.subjectId, subjectId) : undefined,
          subjectIds ? inArray(notificationOutbox.subjectId, subjectIds) : undefined,
        ),
      )
      .orderBy(asc(notificationOutbox.createdAt))
      .limit(limit);

    const deliver = async (id: string) => {
      const [claimed] = await db
        .update(notificationOutbox)
        .set({ attempts: sql`${notificationOutbox.attempts} + 1`, nextAttemptAt: new Date(Date.now() + OUTBOX_LEASE_MS), lastAttemptAt: new Date(), lastError: null })
        .where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.state, "pending"), due()))
        .returning();
      if (!claimed) return "lost" as const;
      try {
        const message = await messageToSend(claimed);
        if (message) await send(message);
        await db
          .update(notificationOutbox)
          .set(message ? { state: "sent", sentAt: new Date(), nextAttemptAt: null } : { state: "skipped", nextAttemptAt: null })
          .where(eq(notificationOutbox.id, id));
        return message ? ("sent" as const) : ("skipped" as const);
      } catch (error) {
        const name = error instanceof Error ? error.name : "unknown";
        const giveUp = claimed.attempts >= OUTBOX_MAX_ATTEMPTS;
        await db
          .update(notificationOutbox)
          .set(giveUp ? { state: "failed", nextAttemptAt: null, lastError: name } : { nextAttemptAt: new Date(Date.now() + outboxBackoffMs(claimed.attempts)), lastError: name })
          .where(eq(notificationOutbox.id, id));
        console.error(`Failed to send a notification (attempt ${claimed.attempts}${giveUp ? ", giving up" : ""})`, {
          notificationId: id,
          kind: claimed.kind,
          error: name,
        });
        return "failed" as const;
      }
    };

    for (let i = 0; i < owed.length; i += OUTBOX_CHUNK) {
      if (halt?.()) break;
      const results = await Promise.all(owed.slice(i, i + OUTBOX_CHUNK).map(({ id }) => deliver(id)));
      for (const result of results) if (result !== "lost") report[result]++;
      if (results.every((result) => result === "failed")) break;
    }
  } catch (error) {
    console.error("Failed to send notifications", error instanceof Error ? error.name : "unknown");
  }
  return report;
}

/** Lets notifications that gave up be sent again, from scratch (all of them, or one order's or subject's). The state they talk about is looked at again when they are sent. Returns how many. */
export async function resumeNotifications({ enrollmentId, subjectId }: { enrollmentId?: string; subjectId?: string } = {}) {
  const resumed = await db
    .update(notificationOutbox)
    .set({ state: "pending", attempts: 0, nextAttemptAt: null, lastError: null })
    .where(and(eq(notificationOutbox.state, "failed"), enrollmentId ? eq(notificationOutbox.enrollmentId, enrollmentId) : undefined, subjectId ? eq(notificationOutbox.subjectId, subjectId) : undefined))
    .returning({ id: notificationOutbox.id });
  return resumed.length;
}

/**
 * The moment a service began recording the mail it owes for a kind of token (a row of kind `epoch`, written once, never
 * dispatched). The mails of tokens made before it were sent inline by the code that ran then, and say nothing about whether they
 * arrived; the ones made after it are the outbox's to account for. Returns the moment (the first call's, if there were several).
 */
export async function ensureEpoch(name = "reset-password") {
  await db
    .insert(notificationOutbox)
    // the application's clock, like better-auth's createdAt of the tokens it is compared with (the database's would add the skew between the two)
    .values({ dedupeKey: `epoch:${name}`, kind: "epoch", state: "skipped", message: null, createdAt: new Date() })
    .onConflictDoNothing({ target: notificationOutbox.dedupeKey });
  const [row] = await db.select({ at: notificationOutbox.createdAt }).from(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `epoch:${name}`));
  return row!.at;
}

/**
 * Records the password-reset mails whose token exists but whose mail was never recorded: better-auth stores the token and then
 * calls us, in two steps we don't control, so a crash between them (or an outage with the token's whole lifetime in front of it)
 * loses the mail. A token is owed one when it
 *   - is unexpired (better-auth deletes a used one, so a used token isn't there at all) and its user still exists,
 *   - was made after the epoch (`ensureEpoch`): an earlier one was mailed inline by the code before this, which we can't tell from
 *     one that never was, so it is left alone rather than mailed twice,
 *   - is older than a minute (the request that made it has had its time to record its own),
 *   - has no outbox row (the key is the verification row's id, so one that was recorded, sent, skipped or failed is never recorded again).
 * No age ceiling: the token's own expiry is the bound, so an outage shorter than that doesn't lose it. Without an epoch (no service
 * has declared itself) nothing is recorded. A token made after the epoch by a pod of the older version, which mails inline and
 * records nothing, is mailed a second time: the same link to the same person, once, during a rollout. The mail itself is composed
 * when it's sent, from the token, which is never copied here. Returns how many were recorded.
 */
export async function recordMissingResetMails({ verificationIds, epochName = "reset-password" }: { verificationIds?: string[]; epochName?: string } = {}) {
  const since = (await db.select({ at: notificationOutbox.createdAt }).from(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `epoch:${epochName}`)))[0]?.at;
  if (!since) return 0;
  const rows = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(
      and(
        sql`${verifications.identifier} like 'reset-password:%'`,
        gt(verifications.expiresAt, new Date()),
        gte(verifications.createdAt, since),
        lte(verifications.createdAt, new Date(Date.now() - 60_000)),
        sql`exists (select 1 from users u where u.id::text = ${verifications.value})`,
        sql`not exists (select 1 from notification_outbox o where o.dedupe_key = 'reset-password:' || ${verifications.id}::text)`,
        verificationIds ? inArray(verifications.id, verificationIds) : undefined,
      ),
    )
    .orderBy(asc(verifications.createdAt))
    .limit(50);
  await queueNotifications(db, rows.map((row) => ({ key: `reset-password:${row.id}`, kind: "reset-password" as const, subjectId: row.id, message: null })));
  return rows.length;
}

// ---- what an operator sees: ids, kinds, counts and times, never a message ----

export type OutboxStatus = "pending" | "leased" | "retry_scheduled" | "failed" | "sent" | "skipped";

/** The state a row is in for an operator: pending (due now), leased (taken up, in flight), retry scheduled (its last attempt failed), failed (gave up), sent, skipped (stale). */
export function outboxStatus(row: { state: string; attempts: number; nextAttemptAt: Date | null; lastError: string | null }, now = new Date()): OutboxStatus {
  if (row.state !== "pending") return row.state as OutboxStatus;
  if (row.nextAttemptAt && row.nextAttemptAt > now) return row.lastError ? "retry_scheduled" : "leased";
  return "pending";
}

/** Counts per status and the rows that aren't done (oldest first, at most 100 per table), without any message. */
export async function outboxOverview({ enrollmentId }: { enrollmentId?: string } = {}) {
  const now = new Date();
  const emptyCounts = (): Record<OutboxStatus, number> => ({ pending: 0, leased: 0, retry_scheduled: 0, failed: 0, sent: 0, skipped: 0 });

  // the counts are aggregated by the database (a table of sent mail grows without bound); the open rows are a query of their own
  const notificationScope = and(sql`${notificationOutbox.kind} <> 'epoch'`, enrollmentId ? eq(notificationOutbox.enrollmentId, enrollmentId) : undefined);
  const countsSelect = (state: any, next: any, error: any) => ({
    pending: sql<number>`count(*) filter (where ${state} = 'pending' and (${next} is null or ${next} <= now()))::int`,
    leased: sql<number>`count(*) filter (where ${state} = 'pending' and ${next} > now() and ${error} is null)::int`,
    retry_scheduled: sql<number>`count(*) filter (where ${state} = 'pending' and ${next} > now() and ${error} is not null)::int`,
    failed: sql<number>`count(*) filter (where ${state} = 'failed')::int`,
    sent: sql<number>`count(*) filter (where ${state} = 'sent')::int`,
    skipped: sql<number>`count(*) filter (where ${state} = 'skipped')::int`,
  });
  const [notificationCounts] = await db
    .select(countsSelect(notificationOutbox.state, notificationOutbox.nextAttemptAt, notificationOutbox.lastError))
    .from(notificationOutbox)
    .where(notificationScope);
  const notificationOpen = await db
    .select({
      id: notificationOutbox.id,
      kind: notificationOutbox.kind,
      state: notificationOutbox.state,
      attempts: notificationOutbox.attempts,
      nextAttemptAt: notificationOutbox.nextAttemptAt,
      lastError: notificationOutbox.lastError,
      createdAt: notificationOutbox.createdAt,
    })
    .from(notificationOutbox)
    .where(and(inArray(notificationOutbox.state, ["pending", "failed"]), notificationScope))
    .orderBy(asc(notificationOutbox.createdAt))
    .limit(100);

  const ticketScope = enrollmentId ? inArray(ticketMailOutbox.ticketId, db.select({ id: tickets.id }).from(tickets).where(eq(tickets.enrollmentId, enrollmentId))) : undefined;
  const [ticketCounts] = await db
    .select(countsSelect(ticketMailOutbox.state, ticketMailOutbox.nextAttemptAt, ticketMailOutbox.lastError))
    .from(ticketMailOutbox)
    .where(ticketScope);
  const ticketOpen = await db
    .select({
      id: ticketMailOutbox.ticketId,
      state: ticketMailOutbox.state,
      attempts: ticketMailOutbox.attempts,
      nextAttemptAt: ticketMailOutbox.nextAttemptAt,
      lastError: ticketMailOutbox.lastError,
      createdAt: ticketMailOutbox.createdAt,
    })
    .from(ticketMailOutbox)
    .where(and(inArray(ticketMailOutbox.state, ["pending", "failed"]), ticketScope))
    .orderBy(asc(ticketMailOutbox.createdAt))
    .limit(100);

  const countsOf = (row: Record<OutboxStatus, number> | undefined): Record<OutboxStatus, number> => row ?? emptyCounts();
  const withStatus = <T extends { state: string; attempts: number; nextAttemptAt: Date | null; lastError: string | null }>(rows: T[]) =>
    rows.map((row) => ({ ...row, status: outboxStatus(row, now) }));
  return {
    notifications: { counts: countsOf(notificationCounts), open: withStatus(notificationOpen) },
    ticketMails: { counts: countsOf(ticketCounts), open: withStatus(ticketOpen.map((row) => ({ ...row, kind: "ticket" }))) },
  };
}
