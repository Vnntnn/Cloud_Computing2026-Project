import {
  and, asc, count, db, desc, dispatchNotifications, eq, eventInvitations, events, ilike, inArray, isNotNull, isNull, or, queueNotifications,
  users,
} from "@app/db";
import { enqueueMail, type MailMessage } from "@app/mail";
import { invitationTaken } from "@app/tickets";
import { HTTPError } from "elysia";
import { isForeignKeyViolation, isUniqueViolation } from "../../libs/errors";
import type * as InvitationModel from "./model";

export const MAX_INVITATIONS_PER_EVENT = 1000;

export class InvitationNotFound extends HTTPError.id("INVITATION_NOT_FOUND", 404) {
  override readonly detail = "ไม่พบคำเชิญนี้";
}

export class InvitationExists extends HTTPError.id("INVITATION_EXISTS", 409) {
  override readonly detail = "อีเมลนี้ได้รับเชิญแล้ว";
}

export class InvitationUsed extends HTTPError.id("INVITATION_USED", 409) {
  override readonly detail = "คำเชิญนี้ถูกใช้ลงทะเบียนแล้ว จึงแก้ไขหรือลบไม่ได้";
}

export class InvitationLimitReached extends HTTPError.id("INVITATION_LIMIT_REACHED", 409) {
  override readonly detail = `เชิญได้สูงสุด ${MAX_INVITATIONS_PER_EVENT.toLocaleString()} อีเมลต่ออีเวนต์`;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Better Auth stores emails lowercase, so the invitation and the account match on equality.
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// An invitation with the account registered under its email, if any.
const withUser = () =>
  db
    .select({ invitation: eventInvitations, user: { id: users.id, name: users.name, image: users.image } })
    .from(eventInvitations)
    .leftJoin(users, eq(users.email, eventInvitations.email));

type Row = Awaited<ReturnType<ReturnType<typeof withUser>["where"]>>[number];

const toInvitation = ({ invitation, user }: Row): InvitationModel.Invitation => ({
  id: invitation.id,
  email: invitation.email,
  status: invitation.usedAt ? "used" : "unused",
  notifiedAt: invitation.notifiedAt?.toISOString() ?? null,
  usedAt: invitation.usedAt?.toISOString() ?? null,
  createdAt: invitation.createdAt.toISOString(),
  user,
});

const newestFirst = [desc(eventInvitations.createdAt), asc(eventInvitations.id)];

const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";

type InvitedEvent = { title: string; slug: string; venue: string; startsAt: Date };

/** `name`: the invitee's account name, or undefined when they have no account yet (they're sent to sign up). */
function invitationMail(event: InvitedEvent, email: string, name: string | undefined): MailMessage {
  const path = `/events/${event.slug}`;
  const url = name ? `${appUrl}${path}` : `${appUrl}/register?redirect=${encodeURIComponent(path)}`;
  return {
    to: email,
    template: "event-invitation",
    props: {
      name: name ?? null,
      email,
      event: { title: event.title, venue: event.venue, startsAt: event.startsAt.toISOString() },
      url,
    },
  };
}

/**
 * Claims every invitation of the event not mailed yet (notified_at set) and records its mail in the notification outbox,
 * in `tx`: the transaction that made the invitation, or the one that switched the event to invite-only (a draft's invitees
 * would only reach a page they can't open; they're mailed once it switches). So a crash can't leave an invitation saved with
 * no mail owed, or claimed with none recorded, and overlapping calls never record anyone twice. Returns the invitations whose
 * mail was recorded; `dispatchRecordedInvitations` sends them after the commit (and the payment service's reconciler, if that
 * didn't happen). The key holds the address and the claim's time: re-addressed, or claimed again after the event went back to
 * a draft, an invitation is a new mail, never one the outbox already closed.
 */
export async function recordPendingInvitations(tx: Tx, eventId: string) {
  const [event] = await tx
    .select({ status: events.status, title: events.title, slug: events.slug, venue: events.venue, startsAt: events.startsAt })
    .from(events)
    .where(eq(events.id, eventId));
  if (event?.status !== "invite") return [];

  const at = new Date();
  const claimed = await tx
    .update(eventInvitations)
    .set({ notifiedAt: at })
    .where(and(eq(eventInvitations.eventId, eventId), isNull(eventInvitations.notifiedAt)))
    .returning({ id: eventInvitations.id, email: eventInvitations.email });
  if (claimed.length === 0) return [];

  const accounts = await tx
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.email, claimed.map((row) => row.email)));
  const names = new Map(accounts.map((account) => [account.email, account.name]));
  await queueNotifications(
    tx,
    claimed.map((row) => ({
      key: `event-invitation:${row.id}:${row.email}:${at.getTime()}`,
      kind: "event-invitation" as const,
      subjectId: row.id,
      message: invitationMail(event, row.email, names.get(row.email)),
    })),
  );
  return claimed.map((row) => row.id);
}

/** Sends the mails recorded for these invitations (all of them, however many). Never throws. */
export const dispatchRecordedInvitations = (ids: string[]) =>
  ids.length > 0 ? dispatchNotifications(enqueueMail, { subjectIds: ids, limit: Math.max(ids.length, 50) }) : undefined;

/** Records and sends the mails of the event's unmailed invitations. Never throws: the invitation or event is already saved, and mail mustn't fail that request. */
export async function sendPendingInvitations(eventId: string) {
  try {
    await dispatchRecordedInvitations(await db.transaction((tx) => recordPendingInvitations(tx, eventId)));
  } catch (error) {
    console.error("Failed to send invitation mail", error);
  }
}

/** Whether `email` is invited to the event; this is what lets someone open an invite-only event. */
export async function isInvited(eventId: string, email: string) {
  const [row] = await db
    .select({ id: eventInvitations.id })
    .from(eventInvitations)
    .where(and(eq(eventInvitations.eventId, eventId), eq(eventInvitations.email, normalizeEmail(email))));
  return !!row;
}

export async function listInvitations(eventId: string, query: InvitationModel.ByIdInvitationsGet["Query"]) {
  const { page = 1, pageSize = 10 } = query;
  const term = query.q?.trim();
  const pattern = term ? `%${escapeLike(term)}%` : undefined;
  const scope = and(
    eq(eventInvitations.eventId, eventId),
    pattern ? or(ilike(eventInvitations.email, pattern), ilike(users.name, pattern)) : undefined,
  );
  const where = and(
    scope,
    query.status === "used"
      ? isNotNull(eventInvitations.usedAt)
      : query.status === "unused"
        ? isNull(eventInvitations.usedAt)
        : undefined,
  );

  const [rows, [totals]] = await Promise.all([
    withUser()
      .where(where)
      .orderBy(...newestFirst)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      // count(column) skips nulls, so it counts the used ones
      .select({ all: count(), used: count(eventInvitations.usedAt) })
      .from(eventInvitations)
      .leftJoin(users, eq(users.email, eventInvitations.email))
      .where(scope),
  ]);
  const counts = { used: totals?.used ?? 0, unused: (totals?.all ?? 0) - (totals?.used ?? 0) };
  return {
    items: rows.map(toInvitation),
    total: query.status ? counts[query.status] : counts.used + counts.unused,
    counts,
  };
}

// Locks the event row, so concurrent invites to the same event can't overshoot the limit together.
const lockEvent = (tx: Tx, eventId: string) =>
  tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).for("update");

/**
 * Invites every email not invited yet (the rest come back in `skipped`), and emails them if the
 * event is invite-only. All or nothing against the limit.
 */
export async function createInvitations(eventId: string, emails: string[]) {
  const unique = [...new Set(emails.map(normalizeEmail))];
  const created = await db.transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const [existing] = await tx
      .select({ total: count() })
      .from(eventInvitations)
      .where(eq(eventInvitations.eventId, eventId));
    const taken = await tx
      .select({ email: eventInvitations.email })
      .from(eventInvitations)
      .where(and(eq(eventInvitations.eventId, eventId), inArray(eventInvitations.email, unique)));
    const fresh = unique.filter((email) => !taken.some((row) => row.email === email));
    if ((existing?.total ?? 0) + fresh.length > MAX_INVITATIONS_PER_EVENT) return new InvitationLimitReached();
    if (fresh.length === 0) return { rows: [], owed: [] as string[] };
    // a concurrent email change (which doesn't lock the event) may still take one; it's skipped then
    const rows = await tx
      .insert(eventInvitations)
      .values(fresh.map((email) => ({ eventId, email })))
      .onConflictDoNothing()
      .returning({ id: eventInvitations.id, email: eventInvitations.email });
    // their mail is recorded with them (if the event is invite-only)
    return { rows, owed: rows.length > 0 ? await recordPendingInvitations(tx, eventId) : [] };
  });
  if (created instanceof Error) return created;
  const inserted = created.rows;
  // awaited, so the response already shows them as emailed
  try {
    await dispatchRecordedInvitations(created.owed);
  } catch (error) {
    console.error("Failed to send invitation mail", error);
  }

  const rows = inserted.length
    ? await withUser()
        .where(inArray(eventInvitations.id, inserted.map((row) => row.id)))
        .orderBy(...newestFirst)
    : [];
  const invitedEmails = new Set(inserted.map((row) => row.email));
  return { invited: rows.map(toInvitation), skipped: unique.filter((email) => !invitedEmails.has(email)) };
}

async function getInvitation(invitationId: string) {
  const [row] = await withUser().where(eq(eventInvitations.id, invitationId));
  return row ? toInvitation(row) : new InvitationNotFound();
}

/**
 * Fixes the email of an unused invitation, and emails the new address. The row is locked, so it
 * can't be used for an enrollment while the email changes under it.
 */
export async function updateInvitation(
  eventId: string,
  invitationId: string,
  input: InvitationModel.ByIdInvitationsByInvitationIdPatch["Body"],
) {
  const email = normalizeEmail(input.email);
  try {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ email: eventInvitations.email, usedAt: eventInvitations.usedAt })
        .from(eventInvitations)
        .where(and(eq(eventInvitations.id, invitationId), eq(eventInvitations.eventId, eventId)))
        .for("update");
      if (!current) return new InvitationNotFound();
      // an enrollment waiting for payment or approval is about to use it
      if (current.usedAt || (await invitationTaken(tx, invitationId))) return new InvitationUsed();
      if (current.email === email) return [] as string[];
      // the new address hasn't been emailed yet: its mail is recorded with the change
      await tx
        .update(eventInvitations)
        .set({ email, notifiedAt: null })
        .where(eq(eventInvitations.id, invitationId));
      return await recordPendingInvitations(tx, eventId);
    });
    if (result instanceof Error) return result;
    await dispatchRecordedInvitations(result);
  } catch (error) {
    if (isUniqueViolation(error)) return new InvitationExists();
    throw error;
  }
  return getInvitation(invitationId);
}

/**
 * Revokes an unused invitation. A used one stays: it records how the invitee got their ticket.
 * So does one any enrollment refers to (ON DELETE RESTRICT), e.g. one waiting for payment.
 */
export async function deleteInvitation(eventId: string, invitationId: string) {
  const match = and(eq(eventInvitations.id, invitationId), eq(eventInvitations.eventId, eventId));
  let deleted;
  try {
    [deleted] = await db
      .delete(eventInvitations)
      .where(and(match, isNull(eventInvitations.usedAt)))
      .returning({ id: eventInvitations.id });
  } catch (error) {
    if (isForeignKeyViolation(error)) return new InvitationUsed();
    throw error;
  }
  if (deleted) return deleted;
  const [existing] = await db.select({ id: eventInvitations.id }).from(eventInvitations).where(match);
  return existing ? new InvitationUsed() : new InvitationNotFound();
}
