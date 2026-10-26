import { type AnyPgColumn, check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { id, timestamps } from "./_columns";
import { users } from "./auth";
import { eventInvitations, events, ticketTypes } from "./event";

// pending: an approval ticket waiting for the organizer
// awaiting_payment: a paid one; its seats are held until expires_at (see docs/tickets.md)
// expired: the payment hold ran out (or the payment failed)
// cancelled: refunded by its buyer (under its refund policy) or by the organizer
export const enrollmentStatus = pgEnum("enrollment_status", [
  "pending",
  "awaiting_payment",
  "confirmed",
  "rejected",
  "expired",
  "cancelled",
]);

// One order: `quantity` tickets of one ticket type, bought (or requested) by one account.
// Owned by apps/registration; apps/payment moves it out of awaiting_payment.
export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    // restrict: an event or ticket type with enrollments can't be deleted
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "restrict" }),
    ticketTypeId: uuid("ticket_type_id").notNull().references(() => ticketTypes.id, { onDelete: "restrict" }),
    // set null: deleting the buyer's account keeps the tickets of everyone else on the order
    buyerId: uuid("buyer_id").references(() => users.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull(),
    // THB per ticket when ordered; the ticket type's price may change later
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
    status: enrollmentStatus("status").notNull(),
    // invite tickets: the invitation this enrollment uses (its used_at is set on confirm)
    invitationId: uuid("invitation_id").references(() => eventInvitations.id, { onDelete: "restrict" }),
    // awaiting_payment: the hold (first_come, invite) or the payment deadline (approval)
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // the payment that confirmed this order, set with the confirmation under the enrollment's lock, so a
    // second paid session is the duplicate however the two race; null for a free or approval-free order, and for orders confirmed before this existed
    acceptedPaymentId: uuid("accepted_payment_id").references((): AnyPgColumn => payments.id, { onDelete: "set null" }),
    // the event's refund policy when ordered (null = no refunds); later edits don't change it
    refundPercent: integer("refund_percent"),
    refundCutoffHours: integer("refund_cutoff_hours"),
    ...timestamps,
  },
  (table) => [
    index("enrollments_ticket_type_id_status_idx").on(table.ticketTypeId, table.status),
    index("enrollments_event_id_status_idx").on(table.eventId, table.status),
    index("enrollments_buyer_id_idx").on(table.buyerId),
    index("enrollments_invitation_id_idx").on(table.invitationId),
    check("enrollments_quantity_check", sql`${table.quantity} >= 1`),
    check(
      "enrollments_refund_check",
      sql`(${table.refundPercent} is null) = (${table.refundCutoffHours} is null) and (${table.refundPercent} is null or ${table.refundPercent} between 0 and 100)`,
    ),
  ],
);

// Seats of a first_come ticket type an account holds while it fills in the enroll form, until
// expires_at. One row per account and ticket type: a lapsed row is reused by the next hold, and
// enrolling deletes it. Owned by apps/registration (see docs/tickets.md).
export const seatHolds = pgTable(
  "seat_holds",
  {
    id: id(),
    // cascade: a hold is never worth keeping a ticket type, event or account around for
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    ticketTypeId: uuid("ticket_type_id").notNull().references(() => ticketTypes.id, { onDelete: "cascade" }),
    holderId: uuid("holder_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("seat_holds_ticket_type_id_holder_id_idx").on(table.ticketTypeId, table.holderId),
    index("seat_holds_event_id_expires_at_idx").on(table.eventId, table.expiresAt),
    index("seat_holds_holder_id_idx").on(table.holderId),
    check("seat_holds_quantity_check", sql`${table.quantity} >= 1`),
  ],
);

/** One answer to a ticket type's question, copied with its label when the ticket was made. */
export type TicketAnswer = { questionId: string; label: string; value: string };

// One attendee. Shown in the account of the buyer and of whoever has this email.
export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    enrollmentId: uuid("enrollment_id").notNull().references(() => enrollments.id, { onDelete: "cascade" }),
    // what the ticket's QR code holds, for check-in
    code: text("code").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    // lowercase, like Better Auth's users.email, so they match on equality
    email: text("email").notNull(),
    answers: jsonb("answers").$type<TicketAnswer[]>().notNull().default([]),
    ...timestamps,
  },
  (table) => [
    index("tickets_enrollment_id_idx").on(table.enrollmentId),
    index("tickets_email_idx").on(table.email),
  ],
);

// refunded: a refund was issued for it (maybe partial; see refunds)
export const paymentStatus = pgEnum("payment_status", ["pending", "paid", "expired", "refunded"]);

// One Stripe Checkout session for an enrollment. Owned by apps/payment.
export const payments = pgTable(
  "payments",
  {
    id: id(),
    enrollmentId: uuid("enrollment_id").notNull().references(() => enrollments.id, { onDelete: "restrict" }),
    stripeSessionId: text("stripe_session_id").notNull().unique(),
    checkoutUrl: text("checkout_url").notNull(),
    // THB
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    // when the Checkout session stops accepting payment
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // Recovery (apps/payment libs/settle.ts, libs/reconcile.ts). next_at: nobody works on the payment before it, which
    // is also the lease of whoever does (set by the claim pending → paid, and by every attempt); attempts: how many
    // times it was taken up; hold: why recovery stopped and a person has to look (over_limit: paid after the hold
    // lapsed and past max_per_user; exhausted: attempts ran out; inconsistent: a paid row the code can't trust).
    recoveryAttempts: integer("recovery_attempts").notNull().default(0),
    recoveryNextAt: timestamp("recovery_next_at", { withTimezone: true }),
    recoveryHold: text("recovery_hold"),
    ...timestamps,
  },
  (table) => [
    index("payments_enrollment_id_idx").on(table.enrollmentId),
    check("payments_recovery_hold_check", sql`${table.recoveryHold} in ('over_limit', 'exhausted', 'inconsistent')`),
    // added NOT VALID in the migration: rows older than it are left as they are, and a held row (recovery_hold set, see the
    // reconciler) may be one of them, so that a malformed old row can still be marked as held (`= 'x'` would be null, and pass, without a hold)
    check(
      "payments_paid_at_check",
      sql`${table.status} not in ('paid', 'refunded') or ${table.paidAt} is not null or ${table.recoveryHold} is not null`,
    ),
  ],
);

// A ticket mail owed to one attendee, recorded in the transaction that confirms the order so a crash can't lose it.
// apps/payment's reconciler (and the confirming request, right after commit) sends it: at least once, see libs/outbox in packages/tickets.
// pending → sent; failed after too many attempts; skipped when the order is no longer confirmed.
export const ticketMailOutbox = pgTable(
  "ticket_mail_outbox",
  {
    ticketId: uuid("ticket_id").primaryKey().references(() => tickets.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    // as in notification_outbox
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ticket_mail_outbox_state_idx").on(table.state, table.nextAttemptAt),
    check("ticket_mail_outbox_state_check", sql`${table.state} in ('pending', 'sent', 'failed', 'skipped')`),
  ],
);

// Stripe's refund statuses; requires_action: waiting for the buyer to tell us where to send the
// money (a refund made by hand, see refunds.stripe_refund_id)
export const refundStatus = pgEnum("refund_status", ["pending", "requires_action", "succeeded", "failed", "canceled"]);

// system: a payment that landed after its hold lapsed, or a second payment for one enrollment
export const refundInitiator = pgEnum("refund_initiator", ["buyer", "organizer", "system"]);

// A refund of a paid payment, at most one per payment. Owned by apps/payment.
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    enrollmentId: uuid("enrollment_id").notNull().references(() => enrollments.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
    // THB
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    // of the payment's amount
    percent: integer("percent").notNull(),
    status: refundStatus("status").notNull(),
    initiatedBy: refundInitiator("initiated_by").notNull(),
    // the buyer or organizer who asked for it; null for the system
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    // the organizer's message to the buyer, or the system's reason (duplicate, unavailable)
    note: text("note"),
    // null: made by hand, for a payment Stripe can't refund by itself (anything but a card, e.g.
    // PromptPay); the buyer was mailed how to claim it
    stripeRefundId: text("stripe_refund_id").unique(),
    failureReason: text("failure_reason"),
    // An intent (status pending, no stripe_refund_id yet, not made by hand) is recorded before Stripe is asked, so the
    // refund can be finished (the Stripe idempotency key is derived from this row's id) if the process dies in between.
    // recovery_next_at: nobody takes the intent up before it (it's also the lease of whoever does); attempts: how many times the
    // scheduler did; hold: why it stopped (exhausted) and a person has to look. See apps/payment libs/refund.ts.
    recoveryAttempts: integer("recovery_attempts").notNull().default(0),
    recoveryNextAt: timestamp("recovery_next_at", { withTimezone: true }),
    recoveryHold: text("recovery_hold"),
    ...timestamps,
  },
  (table) => [
    index("refunds_enrollment_id_idx").on(table.enrollmentId),
    check("refunds_recovery_hold_check", sql`${table.recoveryHold} in ('exhausted')`),
    uniqueIndex("refunds_payment_id_idx").on(table.paymentId),
    check("refunds_percent_check", sql`${table.percent} between 1 and 100`),
  ],
);

// Every other mail that follows a state change, recorded in the transaction that makes the change (a refund recorded, an order
// approved or rejected, a refund that failed or was cancelled, an organizer application decided, an invitation recorded) and sent
// after it, by whoever calls dispatchNotifications (notifications.ts here): the request right after commit, and apps/payment's
// reconciler for what a crash left. `message` is the whole mail as it was when the change was made, or null for a mail that is
// composed when it is sent because it carries a secret the database already holds (a password reset link: its token lives in
// `verifications`, and is never copied here). Before sending, the state the mail talks about is looked at again, so a stale one
// is `skipped`. dedupe_key names the logical mail (e.g. refund-system:<refund id>), so it is recorded once however often a step runs.
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: id(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    kind: text("kind").notNull(),
    // set for the mails of an order; null for the others
    enrollmentId: uuid("enrollment_id").references(() => enrollments.id, { onDelete: "cascade" }),
    refundId: uuid("refund_id").references(() => refunds.id, { onDelete: "cascade" }),
    // the thing the mail is about when it isn't an order: an invitation, an organizer application, a reset-password verification
    subjectId: uuid("subject_id"),
    message: jsonb("message"),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    // when it was last taken up, and why the last attempt failed (an error name, never a message): pending + a future
    // next_attempt_at is `leased` with no last_error, `retry scheduled` with one
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notification_outbox_state_idx").on(table.state, table.nextAttemptAt),
    index("notification_outbox_enrollment_id_idx").on(table.enrollmentId),
    index("notification_outbox_subject_id_idx").on(table.subjectId),
    check("notification_outbox_state_check", sql`${table.state} in ('pending', 'sent', 'failed', 'skipped')`),
  ],
);

export const enrollmentsRelations = relations(enrollments, ({ one, many }) => ({
  event: one(events, { fields: [enrollments.eventId], references: [events.id] }),
  ticketType: one(ticketTypes, { fields: [enrollments.ticketTypeId], references: [ticketTypes.id] }),
  buyer: one(users, { fields: [enrollments.buyerId], references: [users.id] }),
  invitation: one(eventInvitations, { fields: [enrollments.invitationId], references: [eventInvitations.id] }),
  tickets: many(tickets),
  payments: many(payments),
  refunds: many(refunds),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
  enrollment: one(enrollments, { fields: [tickets.enrollmentId], references: [enrollments.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  enrollment: one(enrollments, { fields: [payments.enrollmentId], references: [enrollments.id] }),
  refund: one(refunds, { fields: [payments.id], references: [refunds.paymentId] }),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
  enrollment: one(enrollments, { fields: [refunds.enrollmentId], references: [enrollments.id] }),
  payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }),
  requester: one(users, { fields: [refunds.requestedBy], references: [users.id] }),
}));
