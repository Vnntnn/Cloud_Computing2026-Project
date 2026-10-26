import type { Role } from "@app/auth-guard";
import {
  and, asc, count, db, desc, eq, eventAssets, eventCategories, events, gte, ilike, isNull, lt, lte, ne, or,
} from "@app/db";
import { deleteFile, fileUrl } from "@app/storage";
import { can, canModerate } from "../../libs/access";
import { cacheEvent, forgetDeletedEvent, readCachedEvent, refreshCachedEvent } from "../../libs/event-cache";
import {
  CategoryNotFound, EventHasEnrollments, EventNotFound, EventSuspended, InvalidRefund, InvalidSchedule, InvalidSlug,
  InviteOnly, isForeignKeyViolation, isUniqueViolation, SlugTaken, SuspendForbidden,
} from "../../libs/errors";
import { sanitizeDescription } from "../../libs/sanitize";
import { isUsableSlug, slugFromTitle } from "../../libs/slug";
import { dispatchRecordedInvitations, isInvited, recordPendingInvitations } from "../invitations/service";
import type * as EventModel from "./model";

export type Viewer = { id: string; role: Role };

type EventRow = typeof events.$inferSelect;
type CategoryRow = typeof eventCategories.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const iso = (date: Date | null) => date?.toISOString() ?? null;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
/** Trimmed text, or null when nothing is left; undefined passes through (field not sent). */
const optionalText = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

const toSummary = (event: EventRow, category: CategoryRow): EventModel.EventSummary => ({
  id: event.id,
  slug: event.slug,
  title: event.title,
  status: event.status,
  category: { id: category.id, name: category.name, nameEn: category.nameEn, slug: category.slug },
  venue: event.venue,
  thumbnailUrl: event.coverImageKey ? fileUrl(event.coverImageKey) : null,
  startsAt: event.startsAt.toISOString(),
  endsAt: event.endsAt.toISOString(),
  publishAt: iso(event.publishAt),
  organizerId: event.organizerId,
});

const toDetail = (event: EventRow, category: CategoryRow): EventModel.EventDetail => ({
  ...toSummary(event, category),
  description: event.description,
  venueDescription: event.venueDescription,
  venueUrl: event.venueUrl,
  isRefundAvailable: event.isRefundAvailable,
  refundCutoffHours: event.refundCutoffHours,
  refundPercent: event.refundPercent,
  createdAt: event.createdAt.toISOString(),
  updatedAt: event.updatedAt.toISOString(),
});

const managesAll = (viewer: Viewer) => can(viewer.role, { event: ["manage-all"] });
const isScheduled = (event: EventModel.EventDetail) => event.publishAt !== null && new Date(event.publishAt) > new Date();

/** Public ones once published; the rest only its owner and admins (invitees are checked in findVisibleEvent). */
const isVisibleTo = (event: EventModel.EventDetail, viewer: Viewer | null) =>
  (event.status === "public" && !isScheduled(event)) ||
  (!!viewer && (viewer.id === event.organizerId || managesAll(viewer)));

const withCategory = () =>
  db
    .select({ event: events, category: eventCategories })
    .from(events)
    .innerJoin(eventCategories, eq(events.categoryId, eventCategories.id));

const searchFilter = (q: string | undefined) => {
  const term = q?.trim();
  if (!term) return undefined;
  const pattern = `%${escapeLike(term)}%`;
  return or(ilike(events.title, pattern), ilike(events.venue, pattern));
};

async function getEventById(id: string) {
  const [row] = await withCategory().where(eq(events.id, id));
  return row ? toDetail(row.event, row.category) : new EventNotFound();
}

/** Re-reads the event after a write and replaces its cached copy, so readers see the change at once. */
export async function refreshEvent(eventId: string, previousSlug?: string) {
  const event = await getEventById(eventId);
  if (!(event instanceof Error)) await refreshCachedEvent(event, previousSlug);
  return event;
}

/** The event by uuid or slug: from Redis, or else from the database (and then cached). Null if there's none. */
async function loadEvent(idOrSlug: string) {
  const byId = UUID.test(idOrSlug);
  const cached = await readCachedEvent(idOrSlug, byId);
  if (cached === "gone") return null;
  if (cached) return cached;
  const [row] = await withCategory().where(eq(byId ? events.id : events.slug, idOrSlug));
  if (!row) return null;
  const event = toDetail(row.event, row.category);
  await cacheEvent(event);
  return event;
}

export async function listPublic(query: EventModel.Get["Query"]) {
  const { page = 1, pageSize = 12, when = "upcoming" } = query;
  const now = new Date();
  const where = and(
    eq(events.status, "public"),
    or(isNull(events.publishAt), lte(events.publishAt, now)),
    when === "upcoming" ? gte(events.endsAt, now) : lt(events.endsAt, now),
    query.categoryId ? eq(events.categoryId, query.categoryId) : undefined,
    query.organizerId ? eq(events.organizerId, query.organizerId) : undefined,
    searchFilter(query.q),
  );
  const [rows, [total]] = await Promise.all([
    withCategory()
      .where(where)
      .orderBy(when === "upcoming" ? asc(events.startsAt) : desc(events.startsAt), asc(events.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(events).where(where),
  ]);
  return { items: rows.map((r) => toSummary(r.event, r.category)), total: total?.total ?? 0 };
}

/** Organizers see their own events; admins see every event (or one organizer's). Recently edited first. */
export async function listMine(viewer: Viewer, query: EventModel.MineGet["Query"]) {
  const { page = 1, pageSize = 12 } = query;
  const owner = managesAll(viewer) ? query.organizerId : viewer.id;
  const scope = and(owner ? eq(events.organizerId, owner) : undefined, searchFilter(query.q));
  const where = and(scope, query.status ? eq(events.status, query.status) : undefined);

  const [rows, byStatus] = await Promise.all([
    withCategory()
      .where(where)
      .orderBy(desc(events.updatedAt), asc(events.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ status: events.status, total: count() }).from(events).where(scope).groupBy(events.status),
  ]);
  const counts = { draft: 0, public: 0, invite: 0, suspended: 0 };
  for (const { status, total } of byStatus) counts[status] = total;
  const total = query.status ? counts[query.status] : byStatus.reduce((sum, row) => sum + row.total, 0);
  return { items: rows.map((r) => toSummary(r.event, r.category)), total, counts };
}

export async function isSlugAvailable(slug: string, excludeId?: string) {
  if (slug.length < 3 || !isUsableSlug(slug)) return { available: false };
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.slug, slug), excludeId ? ne(events.id, excludeId) : undefined));
  return { available: !row };
}

/** The event (by uuid or slug), if `viewer` may open it; what to answer otherwise. */
export async function findVisibleEvent(idOrSlug: string, viewer: (Viewer & { email: string }) | null) {
  const event = await loadEvent(idOrSlug);
  if (!event) return new EventNotFound();
  if (isVisibleTo(event, viewer)) return event;
  if (event.status === "invite") {
    if (viewer && (await isInvited(event.id, viewer.email))) return event;
    // says it's invite-only (and nothing else), so an invitee knows to sign in with the invited email
    return new InviteOnly();
  }
  // any other hidden event answers exactly like a missing one, so its slug doesn't leak
  return new EventNotFound();
}

export const getEvent = (idOrSlug: string, viewer: (Viewer & { email: string }) | null) =>
  findVisibleEvent(idOrSlug, viewer);

export async function createEvent(owner: Viewer, input: EventModel.Post["Body"]) {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (endsAt <= startsAt) return new InvalidSchedule();
  if (input.slug && !isUsableSlug(input.slug)) return new InvalidSlug();

  const title = input.title.trim();
  // a generated slug gets a fresh random suffix if it happens to collide; a chosen one doesn't
  for (let attempt = 0; ; attempt++) {
    try {
      const [event] = await db
        .insert(events)
        .values({
          organizerId: owner.id,
          categoryId: input.categoryId,
          title,
          slug: input.slug ?? slugFromTitle(title),
          venue: input.venue.trim(),
          venueDescription: optionalText(input.venueDescription),
          venueUrl: optionalText(input.venueUrl),
          startsAt,
          endsAt,
        })
        .returning({ id: events.id });
      // also points the slug at it, in case a deleted event's slug was still cached
      return refreshEvent(event!.id);
    } catch (error) {
      if (isForeignKeyViolation(error)) return new CategoryNotFound();
      if (!isUniqueViolation(error)) throw error;
      if (input.slug || attempt >= 2) return new SlugTaken();
    }
  }
}

/**
 * Applies a partial update. The row is locked and re-read, so the checks (schedule, refund
 * policy, suspension) hold against concurrent writes, e.g. an admin suspending mid-edit.
 */
export async function updateEvent(eventId: string, actor: Viewer, input: EventModel.ByIdPatch["Body"]) {
  const moderator = canModerate(actor.role);
  if (input.status === "suspended" && !moderator) return new SuspendForbidden();
  if (input.slug !== undefined && !isUsableSlug(input.slug)) return new InvalidSlug();
  // sanitizing is CPU work, so it runs before the row lock is taken
  const description =
    input.description === undefined || input.description === null
      ? input.description
      : sanitizeDescription(input.description, eventId) || null;

  let previousSlug: string;
  let invitationsOwed: string[] = [];
  try {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
      if (!current) return new EventNotFound();
      if (current.status === "suspended" && !moderator) return new EventSuspended();

      const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
      if (endsAt <= startsAt) return new InvalidSchedule();

      const isRefundAvailable = input.isRefundAvailable ?? current.isRefundAvailable;
      const refundCutoffHours =
        input.refundCutoffHours === undefined ? current.refundCutoffHours : input.refundCutoffHours;
      const refundPercent = input.refundPercent === undefined ? current.refundPercent : input.refundPercent;
      if (isRefundAvailable && (refundCutoffHours === null || refundPercent === null)) return new InvalidRefund();

      await tx
        .update(events)
        .set({
          title: input.title?.trim(),
          slug: input.slug,
          categoryId: input.categoryId,
          description,
          venue: input.venue?.trim(),
          venueDescription: optionalText(input.venueDescription),
          venueUrl: optionalText(input.venueUrl),
          status: input.status,
          publishAt: input.publishAt === undefined ? undefined : input.publishAt ? new Date(input.publishAt) : null,
          startsAt,
          endsAt,
          isRefundAvailable,
          // the policy fields mean nothing without a refund policy
          refundCutoffHours: isRefundAvailable ? refundCutoffHours : null,
          refundPercent: isRefundAvailable ? refundPercent : null,
        })
        .where(eq(events.id, eventId));
      // invitations added before the switch are claimed and their mail recorded with it
      const owed = input.status === "invite" ? await recordPendingInvitations(tx, eventId) : [];
      return { previousSlug: current.slug, owed };
    });
    if (result instanceof Error) return result;
    previousSlug = result.previousSlug;
    invitationsOwed = result.owed;
  } catch (error) {
    if (isUniqueViolation(error)) return new SlugTaken();
    if (isForeignKeyViolation(error)) return new CategoryNotFound();
    throw error;
  }
  // sent now; not awaited, since there may be up to a thousand and the save is already done (it never throws; what isn't sent
  // is retried by the outbox)
  void dispatchRecordedInvitations(invitationsOwed);
  return refreshEvent(eventId, previousSlug);
}

/**
 * Deletes the event (its gallery and ticket types cascade), then its stored files. An event
 * anyone enrolled in stays: enrollments keep it with ON DELETE RESTRICT.
 * Locking the row first keeps a concurrent cover or gallery upload from slipping in between
 * reading the keys and deleting the rows (the media service locks the same row).
 */
export async function deleteEvent(eventId: string, actor: Viewer) {
  const moderator = canModerate(actor.role);
  let deleted;
  try {
    deleted = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ slug: events.slug, status: events.status, coverImageKey: events.coverImageKey })
        .from(events)
        .where(eq(events.id, eventId))
        .for("update");
      if (!current) return new EventNotFound();
      if (current.status === "suspended" && !moderator) return new EventSuspended();

      const assets = await tx.select({ key: eventAssets.key }).from(eventAssets).where(eq(eventAssets.eventId, eventId));
      await tx.delete(events).where(eq(events.id, eventId));
      return { slug: current.slug, keys: [current.coverImageKey, ...assets.map((asset) => asset.key)] };
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) return new EventHasEnrollments();
    throw error;
  }
  if (deleted instanceof Error) return deleted;
  await forgetDeletedEvent(eventId, deleted.slug);
  // best effort, after the commit: a failure leaves an orphaned object, not a failed request
  await Promise.all(deleted.keys.map((key) => deleteFile(key)));
  return { id: eventId };
}
