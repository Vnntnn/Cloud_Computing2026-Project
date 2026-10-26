import { and, db, desc, dispatchNotifications, eq, organizerApplications, queueNotifications, users } from "@app/db";
import { enqueueMail, type MailContent } from "@app/mail";
import { HTTPError } from "elysia";
import { revokeCachedSessions } from "../../libs/auth";
import type * as OrganizerApplicationModel from "./model";

export class ApplicationPending extends HTTPError.id("APPLICATION_PENDING", 409) {
  override readonly detail = "คุณมีคำขอที่รอการพิจารณาอยู่แล้ว";
}

export class ApplicationNotFound extends HTTPError.id("APPLICATION_NOT_FOUND", 404) {
  override readonly detail = "ไม่พบคำขอนี้";
}

export class ApplicationReviewed extends HTTPError.id("APPLICATION_ALREADY_REVIEWED", 409) {
  override readonly detail = "คำขอนี้ได้รับการพิจารณาแล้ว";
}

type Row = typeof organizerApplications.$inferSelect;

const toApplication = (row: Row): OrganizerApplicationModel.Application => ({
  id: row.id,
  organizationName: row.organizationName,
  contact: row.contact,
  reason: row.reason,
  status: row.status,
  reviewNote: row.reviewNote,
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

const isPending = (id: string) =>
  and(eq(organizerApplications.id, id), eq(organizerApplications.status, "pending"));

export async function getLatestApplication(userId: string) {
  const [row] = await db
    .select()
    .from(organizerApplications)
    .where(eq(organizerApplications.userId, userId))
    .orderBy(desc(organizerApplications.createdAt))
    .limit(1);
  return { application: row ? toApplication(row) : null };
}

export async function getApplicationHistory(userId: string) {
  const rows = await db
    .select()
    .from(organizerApplications)
    .where(eq(organizerApplications.userId, userId))
    .orderBy(desc(organizerApplications.createdAt));
  return rows.map(toApplication);
}

export async function createApplication(
  userId: string,
  input: OrganizerApplicationModel.Post["Body"],
) {
  // The partial unique index allows one pending application per user, even under concurrent requests.
  const [row] = await db
    .insert(organizerApplications)
    .values({ userId, ...input })
    .onConflictDoNothing()
    .returning();
  return row ? toApplication(row) : new ApplicationPending();
}

// Withdrawing keeps the row as history: a user can only cancel while pending, and may apply again afterwards.
export async function cancelApplication(userId: string) {
  const [row] = await db
    .update(organizerApplications)
    .set({ status: "cancelled" })
    .where(and(eq(organizerApplications.userId, userId), eq(organizerApplications.status, "pending")))
    .returning();
  return row ? toApplication(row) : new ApplicationNotFound();
}

export async function listApplications({ status, userId }: OrganizerApplicationModel.Get["Query"]) {
  const rows = await db
    .select({
      application: organizerApplications,
      applicant: { id: users.id, name: users.name, email: users.email, image: users.image },
    })
    .from(organizerApplications)
    .innerJoin(users, eq(users.id, organizerApplications.userId))
    .where(
      and(
        status ? eq(organizerApplications.status, status) : undefined,
        userId ? eq(organizerApplications.userId, userId) : undefined,
      ),
    )
    .orderBy(desc(organizerApplications.createdAt));
  return rows.map(({ application, applicant }) => ({ ...toApplication(application), applicant }));
}

/**
 * The mail about an application's decision, recorded in the transaction that saves the decision (the notification outbox,
 * packages/db), so a crash after the commit can't lose it. It is sent after the commit, and by the payment service's reconciler
 * if that didn't happen; and when sent, the application is looked at again: it has to still be in the state the mail announces.
 */
async function recordDecisionMail(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], row: Row, kind: "organizer-approved" | "organizer-rejected", compose: (name: string) => MailContent) {
  const [user] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, row.userId));
  if (!user) return;
  await queueNotifications(tx, [{ key: `${kind}:${row.id}`, kind, subjectId: row.id, message: { to: user.email, ...compose(user.name) } }]);
}

// Not awaited: the review is already saved and its mail recorded; a failure here is retried by the outbox.
const sendDecisionMail = (row: Row) => void dispatchNotifications(enqueueMail, { subjectId: row.id });

export async function approveApplication(id: string, reviewerId: string) {
  const approved = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(organizerApplications)
      .set({ status: "approved", reviewedBy: reviewerId, reviewedAt: new Date() })
      .where(isPending(id))
      .returning();
    if (!row) return null;
    // Only promote plain users, so approving never demotes someone who became an admin meanwhile.
    await tx
      .update(users)
      .set({ role: "organizer" })
      .where(and(eq(users.id, row.userId), eq(users.role, "user")));
    await recordDecisionMail(tx, row, "organizer-approved", (name) => ({
      template: "organizer-approved",
      props: { name, organizationName: row.organizationName, url: `${appUrl}/dashboard` },
    }));
    return row;
  });
  if (!approved) return reviewFailure(id);

  await revokeCachedSessions(approved.userId);
  sendDecisionMail(approved);
  return toApplication(approved);
}

export async function rejectApplication(id: string, reviewerId: string, note?: string) {
  const rejected = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(organizerApplications)
      .set({
        status: "rejected",
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      })
      .where(isPending(id))
      .returning();
    if (!row) return null;
    await recordDecisionMail(tx, row, "organizer-rejected", (name) => ({
      template: "organizer-rejected",
      props: { name, organizationName: row.organizationName, note: row.reviewNote, url: `${appUrl}/profile/organizer` },
    }));
    return row;
  });
  if (!rejected) return reviewFailure(id);

  sendDecisionMail(rejected);
  return toApplication(rejected);
}

async function reviewFailure(id: string) {
  const [existing] = await db
    .select({ id: organizerApplications.id })
    .from(organizerApplications)
    .where(eq(organizerApplications.id, id));
  return existing ? new ApplicationReviewed() : new ApplicationNotFound();
}

const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";
