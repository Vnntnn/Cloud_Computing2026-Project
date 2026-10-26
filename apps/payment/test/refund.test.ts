import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthSession, Role } from "@app/auth-guard";
import type { MailMessage } from "@app/mail";
import Stripe from "stripe";

const enqueueMail = mock(async (_message: MailMessage) => {});
mock.module("@app/mail", () => ({ enqueueMail }));

// Stripe stand-in: payments were made with `paidWith`; refunds are kept (refunds.list reads them
// back) and answer with `nextStatus`; webhook signing is the real thing.
const SECRET = "whsec_test_secret";
const realStripe = new Stripe("sk_test_placeholder");
let paidWith = "card";
let nextStatus = "succeeded";
const chargesList = mock(async (_params: Stripe.ChargeListParams) => ({
  data: [{ payment_method_details: { type: paidWith } }],
}));
const stripeRefunds: Partial<Stripe.Refund>[] = [];
const refundsCreate = mock(async (params: Stripe.RefundCreateParams, _options?: unknown): Promise<Partial<Stripe.Refund>> => {
  const refund = {
    id: `re_test_${crypto.randomUUID()}`,
    status: nextStatus,
    payment_intent: params.payment_intent!,
    metadata: params.metadata as Stripe.Metadata,
  };
  stripeRefunds.push(refund);
  return refund;
});
const refundsList = mock(async (params: Stripe.RefundListParams) => ({
  data: stripeRefunds.filter((refund) => refund.payment_intent === params.payment_intent),
}));
mock.module("../src/libs/stripe", () => ({
  stripe: { charges: { list: chargesList }, refunds: { create: refundsCreate, list: refundsList }, webhooks: realStripe.webhooks },
  webhookSecret: SECRET,
}));

// Stand in for the auth service: the cookie header is the name of a seeded user.
const sessions = new Map<string, AuthSession>();
const resolve = async (headers: Headers) => sessions.get(headers.get("cookie") ?? "") ?? null;
const actual = { ...(await import("@app/auth-guard")) };
mock.module("@app/auth-guard", () => ({
  ...actual,
  authGuard: actual.createAuthGuard(resolve, "test"),
  authenticate: actual.createAuthenticator(resolve),
}));

const { payment: app } = await import("../src/app");
const {
  db, enrollments, eq, eventCategories, eventInvitations, events, inArray, payments, refunds, tickets, ticketTypes, users,
} = await import("@app/db");
const { seatsTaken } = await import("@app/tickets");

const runId = crypto.randomUUID().slice(0, 8);
const userIds: Record<string, string> = {};
const eventIds: string[] = [];
let categoryId: string;

const HOUR = 3_600_000;
const emailOf = (name: string) => `${name}-${runId}@example.com`;
const json = (response: Response): Promise<any> => response.json();

async function seedUser(name: string, role: Role) {
  const [user] = await db.insert(users).values({ name, email: emailOf(name), role }).returning({ id: users.id });
  userIds[name] = user!.id;
  sessions.set(name, {
    user: { id: user!.id, name, email: emailOf(name), image: null, role },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + HOUR) },
  });
}

const request = (method: string, path: string, as: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost/api/payment${path}`, {
      method,
      headers: { cookie: as, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const buyerRefund = (enrollmentId: string, as = "buyer") => request("POST", "/refunds", as, { enrollmentId });
const organizerRefund = (enrollmentId: string, as = "owner", note?: string) =>
  request("POST", `/enrollments/${enrollmentId}/refund`, as, { note });

async function webhook(type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, object: "event", type, data: { object } });
  const signature = await realStripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  return app.handle(
    new Request("http://localhost/api/payment/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      body: payload,
    }),
  );
}

type EventOptions = { startsInHours?: number; status?: "public" | "suspended"; kind?: "first_come" | "approval" | "invite" };

/** An event of the owner's starting in `startsInHours` (48 by default), with one ฿300 ticket type. */
async function ticketType({ startsInHours = 48, status = "public", kind = "first_come" }: EventOptions = {}) {
  const startsAt = new Date(Date.now() + startsInHours * HOUR);
  const [event] = await db
    .insert(events)
    .values({
      organizerId: userIds.owner!,
      categoryId,
      title: "Gala",
      slug: `gala-${crypto.randomUUID().slice(0, 12)}`,
      venue: "Hall",
      status,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR),
    })
    .returning({ id: events.id });
  eventIds.push(event!.id);
  const [type] = await db
    .insert(ticketTypes)
    .values({ eventId: event!.id, kind, name: "VIP", price: "300.00", quota: kind === "first_come" ? 5 : null, maxPerUser: 5 })
    .returning({ id: ticketTypes.id });
  return { eventId: event!.id, ticketTypeId: type!.id };
}

type OrderOptions = {
  status?: "pending" | "confirmed";
  // [percent, cutoff hours] the order was made with; null = no refunds
  policy?: [number, number] | null;
  // false: a free order, with no payment
  paid?: boolean;
  invitationId?: string;
};

/** A two-ticket order of the buyer's, paid ฿600 through Stripe by default, with a 50% / 24 h policy. */
async function order(type: { eventId: string; ticketTypeId: string }, options: OrderOptions = {}) {
  const { status = "confirmed", policy = [50, 24], paid = true, invitationId } = options;
  const [row] = await db
    .insert(enrollments)
    .values({
      ...type,
      buyerId: userIds.buyer,
      quantity: 2,
      unitPrice: paid ? "300.00" : "0.00",
      status,
      invitationId,
      confirmedAt: status === "confirmed" ? new Date() : null,
      refundPercent: policy?.[0] ?? null,
      refundCutoffHours: policy?.[1] ?? null,
    })
    .returning({ id: enrollments.id });
  // the buyer's own ticket and a guest's
  await db.insert(tickets).values(
    [emailOf("buyer"), emailOf("guest")].map((email, i) => ({
      enrollmentId: row!.id,
      code: crypto.randomUUID().slice(0, 10).toUpperCase(),
      firstName: `Guest${i}`,
      lastName: "Tester",
      email,
    })),
  );
  let paymentId: string | undefined;
  if (paid && status === "confirmed") {
    const [payment] = await db
      .insert(payments)
      .values({
        enrollmentId: row!.id,
        stripeSessionId: `cs_test_${crypto.randomUUID()}`,
        checkoutUrl: "https://checkout.stripe.test/x",
        amount: "600.00",
        status: "paid",
        expiresAt: new Date(),
        stripePaymentIntentId: `pi_test_${crypto.randomUUID()}`,
        paidAt: new Date(),
      })
      .returning({ id: payments.id });
    paymentId = payment!.id;
  }
  return { id: row!.id, paymentId };
}

const enrollmentOf = async (id: string) => (await db.select().from(enrollments).where(eq(enrollments.id, id)))[0]!;
const paymentOf = async (id: string) => (await db.select().from(payments).where(eq(payments.id, id)))[0]!;
const refundsOf = (enrollmentId: string) => db.select().from(refunds).where(eq(refunds.enrollmentId, enrollmentId));
const mailedTo = () => enqueueMail.mock.calls.map(([m]) => m.to).sort();

beforeAll(async () => {
  await seedUser("owner", "organizer");
  await seedUser("rival", "organizer");
  await seedUser("admin", "admin");
  await seedUser("buyer", "user");
  await seedUser("other", "user");
  const [category] = await db
    .insert(eventCategories)
    .values({ name: `cat-refund-${runId}`, slug: `cat-refund-${runId}` })
    .returning({ id: eventCategories.id });
  categoryId = category!.id;
});

beforeEach(() => {
  paidWith = "card";
  nextStatus = "succeeded";
  enqueueMail.mockClear();
  refundsCreate.mockClear();
});

afterAll(async () => {
  const ids = (await db.select({ id: enrollments.id }).from(enrollments).where(inArray(enrollments.eventId, eventIds))).map((r) => r.id);
  if (ids.length) {
    await db.delete(refunds).where(inArray(refunds.enrollmentId, ids));
    await db.delete(payments).where(inArray(payments.enrollmentId, ids));
  }
  await db.delete(enrollments).where(inArray(enrollments.eventId, eventIds));
  await db.delete(events).where(inArray(events.id, eventIds));
  await db.delete(eventCategories).where(eq(eventCategories.id, categoryId));
  await db.delete(users).where(inArray(users.id, Object.values(userIds)));
});

describe("buyer refunds", () => {
  test("before the deadline: the policy's percent back, the order cancelled and its seats freed", async () => {
    const type = await ticketType();
    const { id, paymentId } = await order(type);
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(2);

    const response = await buyerRefund(id);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ enrollmentId: id, amount: 300, percent: 50, status: "succeeded", initiatedBy: "buyer" });
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(refundsCreate.mock.calls[0]![0]).toMatchObject({ amount: 30_000, metadata: { paymentId } });

    expect(await enrollmentOf(id)).toMatchObject({ status: "cancelled", cancelledAt: expect.any(Date) });
    expect((await paymentOf(paymentId!)).status).toBe("refunded");
    expect(await refundsOf(id)).toMatchObject([{ amount: "300.00", percent: 50, requestedBy: userIds.buyer, note: null }]);
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(0);
    // the buyer (who is also an attendee) once, and the guest
    expect(mailedTo()).toEqual([emailOf("buyer"), emailOf("guest")].sort());

    expect((await json(await buyerRefund(id))).code).toBe("ALREADY_REFUNDED");
    expect(refundsCreate).toHaveBeenCalledTimes(1);
  });

  test("refuses what the order's policy doesn't cover", async () => {
    const soon = await ticketType({ startsInHours: 12 });
    expect((await json(await buyerRefund((await order(soon)).id))).code).toBe("REFUND_CLOSED");

    const type = await ticketType();
    expect((await json(await buyerRefund((await order(type, { policy: null })).id))).code).toBe("NOT_REFUNDABLE");
    expect((await json(await buyerRefund((await order(type, { policy: [0, 24] })).id))).code).toBe("NOT_REFUNDABLE");
    expect((await json(await buyerRefund((await order(type, { paid: false })).id))).code).toBe("NOT_REFUNDABLE");
    expect((await json(await buyerRefund((await order(type, { status: "pending" })).id))).code).toBe("NOT_REFUNDABLE");
    expect((await buyerRefund((await order(type)).id, "other")).status).toBe(404);
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  test("the policy the order was made with wins over later edits", async () => {
    const type = await ticketType();
    const { id } = await order(type, { policy: [80, 24] });
    await db.update(events).set({ isRefundAvailable: false }).where(eq(events.id, type.eventId));
    expect(await json(await buyerRefund(id))).toMatchObject({ amount: 480, percent: 80 });
  });

  test("an invite order gives its invitation back", async () => {
    const type = await ticketType({ kind: "invite" });
    const [invitation] = await db
      .insert(eventInvitations)
      .values({ eventId: type.eventId, email: emailOf("buyer"), usedAt: new Date() })
      .returning({ id: eventInvitations.id });
    const { id } = await order(type, { invitationId: invitation!.id });
    expect((await buyerRefund(id)).status).toBe(200);
    const [after] = await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation!.id));
    expect(after!.usedAt).toBeNull();
  });

  test("Stripe refusing or unreachable changes nothing", async () => {
    const type = await ticketType();
    const { id, paymentId } = await order(type);
    refundsCreate.mockImplementationOnce(async () => {
      throw new Stripe.errors.StripeConnectionError({ message: "down" });
    });
    const unavailable = await buyerRefund(id);
    expect(unavailable.status).toBe(503);
    expect((await json(unavailable)).code).toBe("REFUND_UNAVAILABLE");

    refundsCreate.mockImplementationOnce(async () => {
      throw new Stripe.errors.StripeInvalidRequestError({ message: "charge_expired_for_refund" });
    });
    expect((await json(await buyerRefund(id))).code).toBe("REFUND_REJECTED");

    expect((await enrollmentOf(id)).status).toBe("confirmed");
    expect((await paymentOf(paymentId!)).status).toBe("paid");
    expect(await refundsOf(id)).toEqual([]);
    expect(enqueueMail).not.toHaveBeenCalled();

    // a refusal isn't replayed: once its cause is fixed, asking again refunds
    expect((await buyerRefund(id)).status).toBe(200);
    expect(refundsCreate).toHaveBeenCalledTimes(3);
  });

  test("a refund Stripe made but we didn't record is recorded on the retry, not made twice", async () => {
    const type = await ticketType();
    const { id, paymentId } = await order(type);
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId!));
    // Stripe said yes, then the transaction rolled back
    const earlier = await refundsCreate({ payment_intent: payment!.stripePaymentIntentId!, amount: 30_000, metadata: { paymentId: paymentId! } });
    refundsCreate.mockClear();

    expect((await buyerRefund(id)).status).toBe(200);
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(await refundsOf(id)).toMatchObject([{ stripeRefundId: earlier.id }]);
  });

  test("not paid by card: refunded by hand, and the buyer is mailed how to claim it", async () => {
    paidWith = "promptpay";
    const type = await ticketType();
    const { id, paymentId } = await order(type);

    const response = await buyerRefund(id);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ amount: 300, percent: 50, status: "requires_action" });
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(await refundsOf(id)).toMatchObject([{ status: "requires_action", stripeRefundId: null }]);
    expect((await paymentOf(paymentId!)).status).toBe("refunded");
    expect((await enrollmentOf(id)).status).toBe("cancelled");
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(0);

    const toBuyer = enqueueMail.mock.calls.find(([m]) => m.to === emailOf("buyer"))![0];
    expect(toBuyer).toMatchObject({
      template: "order-cancelled",
      props: { byOrganizer: false, amount: 300, percent: 50, total: 600, manual: true, orderNumber: id },
    });
  });
});

describe("organizer refunds", () => {
  test("in full, past the buyer's deadline, with a note to the buyer", async () => {
    const type = await ticketType({ startsInHours: 1 });
    const { id } = await order(type, { policy: null });
    expect((await organizerRefund(id, "rival")).status).toBe(403);
    expect((await organizerRefund(id, "buyer")).status).toBe(403);

    const response = await organizerRefund(id, "owner", "  งานเลื่อนไม่มีกำหนด  ");
    expect(await json(response)).toMatchObject({ amount: 600, percent: 100, initiatedBy: "organizer" });
    expect(refundsCreate.mock.calls[0]![0]).toMatchObject({ amount: 60_000 });
    expect(await refundsOf(id)).toMatchObject([{ requestedBy: userIds.owner, note: "งานเลื่อนไม่มีกำหนด" }]);
    expect((await enrollmentOf(id)).status).toBe("cancelled");
    const toBuyer = enqueueMail.mock.calls.find(([m]) => m.to === emailOf("buyer"))![0];
    expect(toBuyer).toMatchObject({ template: "order-cancelled", props: { byOrganizer: true, note: "งานเลื่อนไม่มีกำหนด" } });
  });

  test("a suspended event is frozen for its organizer, not for admins", async () => {
    const { id } = await order(await ticketType({ status: "suspended" }));
    expect((await json(await organizerRefund(id))).code).toBe("EVENT_SUSPENDED");
    expect((await organizerRefund(id, "admin")).status).toBe(200);
  });
});

describe("refund webhooks", () => {
  test("move the status along; a failure is final and mailed once", async () => {
    nextStatus = "pending";
    const { id, paymentId } = await order(await ticketType());
    expect((await json(await buyerRefund(id))).status).toBe("pending");
    expect(enqueueMail.mock.calls.find(([m]) => m.to === emailOf("buyer"))![0]).toMatchObject({ props: { manual: false } });
    const stripeRefundId = (await refundsOf(id))[0]!.stripeRefundId!;
    const event = (status: string, extra: Record<string, unknown> = {}) => ({
      id: stripeRefundId,
      object: "refund",
      status,
      metadata: { paymentId },
      ...extra,
    });

    await webhook("refund.updated", event("succeeded"));
    expect((await refundsOf(id))[0]!.status).toBe("succeeded");

    enqueueMail.mockClear();
    await webhook("refund.failed", event("failed", { failure_reason: "lost_or_stolen_card" }));
    expect((await refundsOf(id))[0]).toMatchObject({ status: "failed", failureReason: "lost_or_stolen_card" });
    expect(mailedTo()).toEqual([emailOf("buyer")]);

    // an older event delivered late, and a redelivery
    await webhook("refund.updated", event("succeeded"));
    await webhook("refund.failed", event("failed", { failure_reason: "lost_or_stolen_card" }));
    expect((await refundsOf(id))[0]!.status).toBe("failed");
    expect(enqueueMail).toHaveBeenCalledTimes(1);
  });

  test("ignore refunds made elsewhere, and retry ours until they're recorded", async () => {
    const elsewhere = await webhook("refund.updated", { id: "re_dashboard", object: "refund", status: "succeeded", metadata: {} });
    expect(elsewhere.status).toBe(200);
    const unrecorded = await webhook("refund.updated", {
      id: "re_unrecorded",
      object: "refund",
      status: "succeeded",
      metadata: { paymentId: crypto.randomUUID() },
    });
    expect(unrecorded.status).toBe(500);
  });

  test("a stale in-progress event delivered after the refund succeeded doesn't move it back", async () => {
    nextStatus = "pending";
    const { id, paymentId } = await order(await ticketType());
    await buyerRefund(id);
    const stripeRefundId = (await refundsOf(id))[0]!.stripeRefundId!;
    const event = (status: string) => ({ id: stripeRefundId, object: "refund", status, metadata: { paymentId } });

    await webhook("refund.updated", event("succeeded"));
    await webhook("refund.updated", event("pending"));
    await webhook("refund.updated", event("requires_action"));
    expect((await refundsOf(id))[0]!.status).toBe("succeeded");

    // a succeeded refund can still fail later
    await webhook("refund.failed", event("failed"));
    expect((await refundsOf(id))[0]!.status).toBe("failed");
  });
});

describe("repeated requests and access", () => {
  test("two refund requests at once refund once: the second is told it's already refunded", async () => {
    const type = await ticketType();
    const { id } = await order(type);
    const [a, b] = await Promise.all([buyerRefund(id), buyerRefund(id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await json(a.status === 409 ? a : b)).code).toBe("ALREADY_REFUNDED");
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(await refundsOf(id)).toHaveLength(1);
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(0);
    // one cancellation mail per recipient
    expect(mailedTo()).toEqual([emailOf("buyer"), emailOf("guest")].sort());
  });

  test("the buyer and the organizer asking at once refund once; the organizer can't refund it again later", async () => {
    const { id } = await order(await ticketType());
    const [a, b] = await Promise.all([buyerRefund(id), organizerRefund(id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect((await json(await organizerRefund(id))).code).toBe("ALREADY_REFUNDED");
    expect((await json(await organizerRefund(id, "admin"))).code).toBe("ALREADY_REFUNDED");
  });

  test("an organizer can't refund an order that was never paid for", async () => {
    const type = await ticketType();
    expect((await json(await organizerRefund((await order(type, { paid: false })).id))).code).toBe("NOT_REFUNDABLE");
    expect((await json(await organizerRefund((await order(type, { status: "pending" })).id))).code).toBe("NOT_REFUNDABLE");
    const [row] = await db
      .insert(enrollments)
      .values({
        ...type,
        buyerId: userIds.buyer,
        quantity: 1,
        unitPrice: "300.00",
        status: "awaiting_payment",
        expiresAt: new Date(Date.now() + 35 * 60_000),
      })
      .returning({ id: enrollments.id });
    expect((await json(await organizerRefund(row!.id))).code).toBe("NOT_REFUNDABLE");
    expect((await json(await buyerRefund(row!.id))).code).toBe("NOT_REFUNDABLE");
    expect(refundsCreate).not.toHaveBeenCalled();
    // nothing was cancelled: the free order, the pending one and the held one still count
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(5);
  });

  test("signed-out callers are refused, and an unknown order is a 404", async () => {
    const { id } = await order(await ticketType());
    const buyer = await buyerRefund(id, "nobody");
    expect(buyer.status).toBe(401);
    expect((await json(buyer)).code).toBe("UNAUTHORIZED");
    expect((await organizerRefund(id, "nobody")).status).toBe(401);
    expect((await request("GET", `/events/${(await ticketType()).eventId}/refunds`, "nobody")).status).toBe(401);
    expect((await json(await buyerRefund(crypto.randomUUID()))).code).toBe("ENROLLMENT_NOT_FOUND");
    expect((await json(await organizerRefund(crypto.randomUUID()))).code).toBe("ENROLLMENT_NOT_FOUND");
    expect((await enrollmentOf(id)).status).toBe("confirmed");
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

describe("event refund history", () => {
  test("lists the event's refunds with totals, for its organizer", async () => {
    const type = await ticketType();
    const byBuyer = await order(type);
    const byOwner = await order(type);
    await buyerRefund(byBuyer.id);
    await organizerRefund(byOwner.id, "owner", "ขออภัย");
    // a refund that failed later doesn't count towards the total
    const failed = await order(type);
    await buyerRefund(failed.id);
    await db.update(refunds).set({ status: "failed" }).where(eq(refunds.enrollmentId, failed.id));

    const path = `/events/${type.eventId}/refunds`;
    expect((await request("GET", path, "rival")).status).toBe(403);
    const list = await json(await request("GET", path, "owner"));
    expect(list.total).toBe(3);
    expect(list.refundedTotal).toBe(900);
    expect(list.counts).toMatchObject({ succeeded: 2, failed: 1 });
    expect(list.items[0]).toMatchObject({ enrollmentId: failed.id, status: "failed" });
    expect(list.items[1]).toMatchObject({
      enrollmentId: byOwner.id,
      initiatedBy: "organizer",
      note: "ขออภัย",
      quantity: 2,
      orderTotal: 600,
      ticketType: { name: "VIP", kind: "first_come" },
      buyer: { id: userIds.buyer, email: emailOf("buyer") },
      requester: { name: "owner" },
    });

    const failedOnly = await json(await request("GET", `${path}?status=failed`, "owner"));
    expect(failedOnly.items.map((item: { enrollmentId: string }) => item.enrollmentId)).toEqual([failed.id]);
    expect(failedOnly.total).toBe(1);
  });
});
