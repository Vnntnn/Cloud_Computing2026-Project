import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { id, timestamps } from "./_columns";
import { users } from "./auth";

// invite: hidden from the explore page; only invited emails (event_invitations) can open it
export const eventStatus = pgEnum("event_status", ["draft", "public", "invite", "suspended"]);

// Only admins manage categories; organizers pick one per event.
export const eventCategories = pgTable("event_categories", {
  id: id(),
  name: text("name").notNull().unique(),
  // the name shown when the site is in English; null = show `name` (the Thai one) in both languages
  nameEn: text("name_en"),
  slug: text("slug").notNull().unique(),
  ...timestamps,
});

export const events = pgTable(
  "events",
  {
    id: id(),
    // restrict: deleting an organizer must not silently take their events (and tickets) with them
    organizerId: uuid("organizer_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    // restrict: a category in use can't be deleted
    categoryId: uuid("category_id").notNull().references(() => eventCategories.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    // sanitized HTML from the WYSIWYG editor
    description: text("description"),
    venue: text("venue").notNull(),
    venueDescription: text("venue_description"),
    venueUrl: text("venue_url"),
    status: eventStatus("status").notNull().default("draft"),
    isRefundAvailable: boolean("is_refund_available").notNull().default(false),
    refundCutoffHours: integer("refund_cutoff_hours"),
    refundPercent: integer("refund_percent"),
    // null = visible as soon as the status is public
    publishAt: timestamp("publish_at", { withTimezone: true }),
    // thumbnail
    coverImageKey: text("cover_image_key"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("events_organizer_id_idx").on(table.organizerId),
    index("events_category_id_idx").on(table.categoryId),
    // the public listing: status = 'public', ordered by start time
    index("events_status_starts_at_idx").on(table.status, table.startsAt),
    uniqueIndex("events_slug_idx").on(table.slug),
    check(
      "events_refund_check",
      sql`${table.isRefundAvailable} = false or (${table.refundCutoffHours} is not null and ${table.refundPercent} between 0 and 100)`,
    ),
  ],
);

// first_come: limited seats, confirmed in order; approval: the organizer approves each enrollment
// (no seat limit); invite: only emails in event_invitations, one enrollment per invitation
export const ticketTypeKind = pgEnum("ticket_type_kind", ["first_come", "approval", "invite"]);

export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: id(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    kind: ticketTypeKind("kind").notNull().default("first_come"),
    name: text("name").notNull(),
    // plain text
    description: text("description"),
    // THB, whole baht; 0 = free
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    // seats; first_come only (the others have no limit)
    quota: integer("quota"),
    // tickets one account may hold of this type, across all its enrollments
    maxPerUser: integer("max_per_user").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("ticket_types_event_id_idx").on(table.eventId),
    check(
      "ticket_types_quota_check",
      sql`(${table.kind} = 'first_come') = (${table.quota} is not null) and (${table.quota} is null or ${table.quota} >= 1)`,
    ),
    check("ticket_types_price_check", sql`${table.price} >= 0`),
    check("ticket_types_max_per_user_check", sql`${table.maxPerUser} between 1 and 10`),
  ],
);

export const questionType = pgEnum("question_type", ["short_text", "long_text", "choice"]);

// The organizer's own questions on a ticket type's registration form, after the fixed
// first name / last name / email every ticket has. Answers are copied onto the ticket, so
// editing or deleting a question never changes what attendees already answered.
export const ticketTypeQuestions = pgTable(
  "ticket_type_questions",
  {
    id: id(),
    ticketTypeId: uuid("ticket_type_id").notNull().references(() => ticketTypes.id, { onDelete: "cascade" }),
    type: questionType("type").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(false),
    // choice only: the options in order
    options: text("options").array(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (table) => [
    index("ticket_type_questions_ticket_type_id_position_idx").on(table.ticketTypeId, table.position),
    check("ticket_type_questions_options_check", sql`(${table.type} = 'choice') = (${table.options} is not null)`),
  ],
);

// Gallery images of an event; the objects live in S3 under public/events/<eventId>/assets/.
export const eventAssets = pgTable(
  "event_assets",
  {
    id: id(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    ...timestamps,
  },
  (table) => [index("event_assets_event_id_idx").on(table.eventId)],
);

// Who may open an invite-only event. Keyed by email (stored lowercase), so people without an
// account yet can be invited; the account is matched by email when they sign in.
export const eventInvitations = pgTable(
  "event_invitations",
  {
    id: id(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // set when the invitation email is queued, which happens only while the event is invite-only;
    // null = not emailed yet (cleared again when the email changes)
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    // set when the invitee enrolls with it (apps/registration); a used invitation is locked
    usedAt: timestamp("used_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("event_invitations_event_id_email_idx").on(table.eventId, table.email)],
);

export const eventCategoriesRelations = relations(eventCategories, ({ many }) => ({
  events: many(events),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  category: one(eventCategories, { fields: [events.categoryId], references: [eventCategories.id] }),
  organizer: one(users, { fields: [events.organizerId], references: [users.id] }),
  ticketTypes: many(ticketTypes),
  assets: many(eventAssets),
  invitations: many(eventInvitations),
}));

export const ticketTypesRelations = relations(ticketTypes, ({ one, many }) => ({
  event: one(events, { fields: [ticketTypes.eventId], references: [events.id] }),
  questions: many(ticketTypeQuestions),
}));

export const ticketTypeQuestionsRelations = relations(ticketTypeQuestions, ({ one }) => ({
  ticketType: one(ticketTypes, { fields: [ticketTypeQuestions.ticketTypeId], references: [ticketTypes.id] }),
}));

export const eventAssetsRelations = relations(eventAssets, ({ one }) => ({
  event: one(events, { fields: [eventAssets.eventId], references: [events.id] }),
}));

export const eventInvitationsRelations = relations(eventInvitations, ({ one }) => ({
  event: one(events, { fields: [eventInvitations.eventId], references: [events.id] }),
}));
