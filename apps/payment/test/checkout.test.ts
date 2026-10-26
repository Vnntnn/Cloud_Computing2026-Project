import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthSession, Role } from "@app/auth-guard";
import type { MailMessage } from "@app/mail";
import Stripe from "stripe";

const enqueueMail = mock(async (_message: MailMessage) => {});
mock.module("@app/mail", () => ({ enqueueMail }));

// Stripe stand-in: sessions and refunds are recorded; webhook signing is the real thing.
const SECRET = "whsec_test_secret";
const realStripe = new Stripe("sk_test_placeholder");
const sessionsCreate = mock(async (_params: Stripe.Checkout.SessionCreateParams) => {
  const id = `cs_test_${crypto.randomUUID()}`;
  return { id, url: `https://checkout.stripe.test/${id}` };
});
// what Stripe says about a session when asked; one not listed is still open
const sessionStates = new Map<string, Partial<Stripe.Checkout.Session>>();
const sessionsRetrieve = mock(async (id: string) => ({
  id,
  object: "checkout.session",
  status: "open",
  payment_status: "unpaid",
  payment_intent: null,
  ...sessionStates.get(id),
}));
const refundsCreate = mock(async (_params: Stripe.RefundCreateParams, _options?: unknown) => ({
  id: `re_test_${crypto.randomUUID()}`,
  status: "succeeded",
}));
// no refund made yet by an earlier attempt
const refundsList = mock(async () => ({ data: [] }));
// how every payment was made
let paidWith = "card";
const chargesList = mock(async () => ({ data: [{ payment_method_details: { type: paidWith } }] }));
mock.module("../src/libs/stripe", () => ({
  stripe: {
    checkout: { sessions: { create: sessionsCreate, retrieve: sessionsRetrieve } },
    charges: { list: chargesList },
    refunds: { create: refundsCreate, list: refundsList },
    webhooks: realStripe.webhooks,
  },
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
const { asc, db, enrollments, eq, eventCategories, events, inArray, payments, refunds, tickets, ticketTypes, users } = await import("@app/db");
const { seatsTaken } = await import("@app/tickets");
const { reconcilePaid, startReconciler, resumePayment } = await import("../src/libs/reconcile");
const { LEASE_MS, MAX_ATTEMPTS, backoffMs } = await import("../src/libs/retry");

const runId = crypto.randomUUID().slice(0, 8);
const userIds: Record<string, string> = {};
const eventIds: string[] = [];
let categoryId: string;

const emailOf = (name: string) => `${name}-${runId}@example.com`;
const json = (response: Response): Promise<any> => response.json();

async function seedUser(name: string, role: Role) {
  const [user] = await db.insert(users).values({ name, email: emailOf(name), role }).returning({ id: users.id });
  userIds[name] = user!.id;
  sessions.set(name, {
    user: { id: user!.id, name, email: emailOf(name), image: null, role },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
  });
}

const buyerPost = (path: string) => (enrollmentId: string, as = "buyer") =>
  app.handle(
    new Request(`http://localhost/api/payment${path}`, {
      method: "POST",
      headers: { cookie: as, "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId }),
    }),
  );
const checkout = buyerPost("/checkout");
const verify = buyerPost("/checkout/verify");

async function webhook(type: string, session: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, object: "event", type, data: { object: session } });
  const signature = await realStripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return app.handle(
    new Request("http://localhost/api/payment/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      body: payload,
    }),
  );
}

const paid = (sessionId: string) =>
  webhook("checkout.session.completed", { id: sessionId, object: "checkout.session", payment_status: "paid", payment_intent: "pi_test" });

async function ticketType(kind: "first_come" | "approval" = "first_come", quota = 5, maxPerUser = 5) {
  const [event] = await db
    .insert(events)
    .values({
      organizerId: userIds.owner!,
      categoryId,
      title: "Gala",
      slug: `gala-${crypto.randomUUID().slice(0, 12)}`,
      venue: "Hall",
      status: "public",
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 2 * 86_400_000),
    })
    .returning({ id: events.id });
  eventIds.push(event!.id);
  const [type] = await db
    .insert(ticketTypes)
    .values({ eventId: event!.id, kind, name: "VIP", price: "300.00", quota: kind === "first_come" ? quota : null, maxPerUser })
    .returning({ id: ticketTypes.id });
  return { eventId: event!.id, ticketTypeId: type!.id };
}

type EnrollOptions = { status?: "pending" | "awaiting_payment" | "confirmed" | "cancelled"; quantity?: number; expiresInMs?: number };

/** An enrollment as apps/registration makes it: a paid one held for 35 minutes by default. */
async function enrollment(type: { eventId: string; ticketTypeId: string }, options: EnrollOptions = {}) {
  const { status = "awaiting_payment", quantity = 2, expiresInMs = 35 * 60_000 } = options;
  const [row] = await db
    .insert(enrollments)
    .values({
      ...type,
      buyerId: userIds.buyer,
      quantity,
      unitPrice: "300.00",
      status,
      expiresAt: status === "awaiting_payment" ? new Date(Date.now() + expiresInMs) : null,
    })
    .returning({ id: enrollments.id });
  await db.insert(tickets).values(
    Array.from({ length: quantity }, (_, i) => ({
      enrollmentId: row!.id,
      code: crypto.randomUUID().slice(0, 10).toUpperCase(),
      firstName: `Guest${i}`,
      lastName: "Tester",
      email: emailOf(`guest${i}`),
    })),
  );
  return row!.id;
}

const statusOf = async (enrollmentId: string) =>
  (await db.select({ status: enrollments.status }).from(enrollments).where(eq(enrollments.id, enrollmentId)))[0]!.status;

const paymentOf = async (enrollmentId: string) =>
  (await db.select().from(payments).where(eq(payments.enrollmentId, enrollmentId)))[0]!;

/** Every session of the order, oldest first. */
const paymentsOf = (enrollmentId: string) =>
  db.select().from(payments).where(eq(payments.enrollmentId, enrollmentId)).orderBy(asc(payments.createdAt));

const MIN = 60_000;

/**
 * What a process that dies mid-settlement leaves behind: a session claimed as paid `agoMs` ago
 * (paid `paidAgoMs` ago) whose order was never confirmed.
 */
async function strand(enrollmentId: string, options: { agoMs?: number; paidAgoMs?: number; intent?: string; status?: "paid" | "pending" | "expired" | "refunded" } = {}) {
  const { agoMs = 11 * MIN, paidAgoMs = agoMs, intent = "pi_test", status = "paid" } = options;
  const sessionId = `cs_test_${crypto.randomUUID()}`;
  const [row] = await db
    .insert(payments)
    .values({
      enrollmentId,
      stripeSessionId: sessionId,
      checkoutUrl: `https://checkout.stripe.test/${sessionId}`,
      amount: "600.00",
      status,
      expiresAt: new Date(Date.now() + 30 * MIN),
      stripePaymentIntentId: intent,
      paidAt: status === "paid" || status === "refunded" ? new Date(Date.now() - paidAgoMs) : null,
      // the lease of whoever claimed it `agoMs` ago
      recoveryNextAt: new Date(Date.now() - agoMs + LEASE_MS),
    })
    .returning();
  return row!;
}

/** Time passing: the lease of the payment's last attempt has run out. */
const ageLease = (paymentId: string) =>
  db.update(payments).set({ recoveryNextAt: new Date(Date.now() - 1000) }).where(eq(payments.id, paymentId));

const refundsOf = (enrollmentId: string) => db.select().from(refunds).where(eq(refunds.enrollmentId, enrollmentId));
const mailsTo = (): string[] => enqueueMail.mock.calls.map(([m]) => m.template);

beforeAll(async () => {
  await seedUser("owner", "organizer");
  await seedUser("buyer", "user");
  await seedUser("other", "user");
  const [category] = await db
    .insert(eventCategories)
    .values({ name: `cat-pay-${runId}`, slug: `cat-pay-${runId}` })
    .returning({ id: eventCategories.id });
  categoryId = category!.id;
});

beforeEach(() => {
  paidWith = "card";
  enqueueMail.mockClear();
  sessionsCreate.mockClear();
  sessionsRetrieve.mockClear();
  refundsCreate.mockClear();
});

afterAll(async () => {
  const ids = (await db.select({ id: enrollments.id }).from(enrollments).where(inArray(enrollments.eventId, eventIds))).map((r) => r.id);
  if (ids.length) await db.delete(refunds).where(inArray(refunds.enrollmentId, ids));
  if (ids.length) await db.delete(payments).where(inArray(payments.enrollmentId, ids));
  await db.delete(enrollments).where(inArray(enrollments.eventId, eventIds));
  await db.delete(events).where(inArray(events.id, eventIds));
  await db.delete(eventCategories).where(eq(eventCategories.id, categoryId));
  await db.delete(users).where(inArray(users.id, Object.values(userIds)));
});

describe("checkout", () => {
  test("only the buyer pays; an open session is reused", async () => {
    const id = await enrollment(await ticketType());
    expect((await checkout(id, "other")).status).toBe(404);

    const first = await json(await checkout(id));
    expect(first.url).toStartWith("https://checkout.stripe.test/");
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const params = sessionsCreate.mock.calls[0]![0];
    expect(params).toMatchObject({ mode: "payment", client_reference_id: id, customer_email: emailOf("buyer") });
    expect(params.line_items![0]).toMatchObject({ quantity: 2, price_data: { currency: "thb", unit_amount: 30_000 } });
    // Stripe's minimum session length
    expect(params.expires_at! * 1000).toBeGreaterThan(Date.now() + 30 * 60_000);

    expect((await json(await checkout(id))).url).toBe(first.url);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect((await paymentOf(id)).amount).toBe("600.00");
  });

  test("refuses enrollments that don't wait for payment", async () => {
    const type = await ticketType("approval");
    expect((await json(await checkout(await enrollment(type, { status: "pending" })))).code).toBe("NOT_PAYABLE");
    expect((await json(await checkout(await enrollment(type, { status: "confirmed" })))).code).toBe("ALREADY_PAID");
    const lapsed = await enrollment(await ticketType(), { expiresInMs: -1000 });
    expect((await json(await checkout(lapsed))).code).toBe("ENROLLMENT_CLOSED");
  });

  test("an approval session ends at the payment deadline, at most 24 hours ahead", async () => {
    const id = await enrollment(await ticketType("approval"), { expiresInMs: 72 * 3_600_000 });
    await checkout(id);
    const expiresAt = sessionsCreate.mock.calls[0]![0].expires_at! * 1000;
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 24 * 3_600_000);
    expect(expiresAt).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });
});

describe("verify", () => {
  test("settles a paid session the webhook missed, once", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    const { stripeSessionId } = await paymentOf(id);
    expect(await json(await verify(id))).toEqual({ status: "awaiting_payment" });

    sessionStates.set(stripeSessionId, { status: "complete", payment_status: "paid", payment_intent: "pi_test" });
    expect((await verify(id, "other")).status).toBe(404);
    expect(await statusOf(id)).toBe("awaiting_payment");
    expect(await json(await verify(id))).toEqual({ status: "confirmed" });
    expect(await paymentOf(id)).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_test" });
    expect(enqueueMail).toHaveBeenCalledTimes(2);

    // the webhook arrives after all, and the buyer checks again: nothing more happens
    enqueueMail.mockClear();
    sessionsRetrieve.mockClear();
    await paid(stripeSessionId);
    expect(await json(await verify(id))).toEqual({ status: "confirmed" });
    expect(sessionsRetrieve).not.toHaveBeenCalled();
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("an expired session ends the seat hold", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    sessionStates.set((await paymentOf(id)).stripeSessionId, { status: "expired" });
    expect(await json(await verify(id))).toEqual({ status: "expired" });
    expect((await paymentOf(id)).status).toBe("expired");
  });

  test("checkout settles a paid session instead of sending the buyer back to it", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    sessionStates.set((await paymentOf(id)).stripeSessionId, { status: "complete", payment_status: "paid", payment_intent: "pi_test" });
    expect((await json(await checkout(id))).code).toBe("ALREADY_PAID");
    expect(await statusOf(id)).toBe("confirmed");
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
  });

  test("Stripe being down is a 503", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    sessionsRetrieve.mockImplementationOnce(async () => {
      throw new Error("Stripe is down");
    });
    expect((await json(await verify(id))).code).toBe("PAYMENT_UNAVAILABLE");
    expect(await statusOf(id)).toBe("awaiting_payment");
  });
});

describe("webhook", () => {
  test("refuses a bad signature", async () => {
    const response = await webhook("checkout.session.completed", { id: "cs_x", payment_status: "paid" }, "whsec_wrong");
    expect(response.status).toBe(400);
  });

  test("a paid session confirms the enrollment and mails its tickets, once", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    const { stripeSessionId } = await paymentOf(id);
    expect((await paid(stripeSessionId)).status).toBe(200);
    expect(await statusOf(id)).toBe("confirmed");
    expect(await paymentOf(id)).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_test" });
    expect(enqueueMail.mock.calls.map(([m]) => m.to).sort()).toEqual([emailOf("guest0"), emailOf("guest1")]);

    enqueueMail.mockClear();
    expect((await paid(stripeSessionId)).status).toBe(200);
    expect(enqueueMail).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  test("an unpaid (delayed) completion waits for async_payment_succeeded", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    const { stripeSessionId } = await paymentOf(id);
    await webhook("checkout.session.completed", { id: stripeSessionId, payment_status: "unpaid", payment_intent: "pi_test" });
    expect(await statusOf(id)).toBe("awaiting_payment");
    await webhook("checkout.session.async_payment_succeeded", { id: stripeSessionId, payment_status: "paid", payment_intent: "pi_test" });
    expect(await statusOf(id)).toBe("confirmed");
  });

  test("an expired session ends a seat hold, but not an approval's deadline", async () => {
    const held = await enrollment(await ticketType());
    await checkout(held);
    await webhook("checkout.session.expired", { id: (await paymentOf(held)).stripeSessionId, payment_status: "unpaid" });
    expect(await statusOf(held)).toBe("expired");
    expect((await paymentOf(held)).status).toBe("expired");

    const approved = await enrollment(await ticketType("approval"), { expiresInMs: 72 * 3_600_000 });
    await checkout(approved);
    await webhook("checkout.session.expired", { id: (await paymentOf(approved)).stripeSessionId, payment_status: "unpaid" });
    expect(await statusOf(approved)).toBe("awaiting_payment");
    // the buyer can start over: a third session (held, approved, and this one)
    await checkout(approved);
    expect(sessionsCreate).toHaveBeenCalledTimes(3);
  });

  test("a payment that lands after its hold lapsed and the seats went is refunded", async () => {
    const type = await ticketType("first_come", 2);
    const late = await enrollment(type);
    await checkout(late);
    // the hold lapses and someone else takes both seats
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, late));
    await enrollment(type, { status: "confirmed" });

    expect((await paid((await paymentOf(late)).stripeSessionId)).status).toBe(200);
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(refundsCreate.mock.calls[0]![0]).toMatchObject({ payment_intent: "pi_test", amount: 60_000 });
    expect(await statusOf(late)).toBe("expired");
    const payment = await paymentOf(late);
    expect(payment.status).toBe("refunded");
    const [refund] = await db.select().from(refunds).where(eq(refunds.paymentId, payment.id));
    expect(refund).toMatchObject({ amount: "600.00", percent: 100, initiatedBy: "system", note: "unavailable", status: "succeeded" });
    expect(enqueueMail.mock.calls.map(([m]) => m.to)).toEqual([emailOf("buyer")]);
  });

  test("a late PromptPay payment is refunded by hand: the buyer is mailed how to claim it", async () => {
    paidWith = "promptpay";
    const type = await ticketType("first_come", 2);
    const late = await enrollment(type);
    await checkout(late);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, late));
    await enrollment(type, { status: "confirmed" });

    expect((await paid((await paymentOf(late)).stripeSessionId)).status).toBe(200);
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(await statusOf(late)).toBe("expired");
    const payment = await paymentOf(late);
    expect(payment.status).toBe("refunded");
    const [refund] = await db.select().from(refunds).where(eq(refunds.paymentId, payment.id));
    expect(refund).toMatchObject({ amount: "600.00", initiatedBy: "system", status: "requires_action", stripeRefundId: null });
    const [mail] = enqueueMail.mock.calls.map(([m]) => m);
    expect(mail).toMatchObject({
      to: emailOf("buyer"),
      template: "refund-system",
      props: { reason: "unavailable", amount: 600, manual: true, orderNumber: late },
    });
  });

  test("a payment for an order cancelled meanwhile is refunded, and the order stays cancelled", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    await db.update(enrollments).set({ status: "cancelled" }).where(eq(enrollments.id, id));
    await paid((await paymentOf(id)).stripeSessionId);
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(await statusOf(id)).toBe("cancelled");
    expect((await paymentOf(id)).status).toBe("refunded");
  });

  test("a late payment still confirms when the seats are free", async () => {
    const late = await enrollment(await ticketType("first_come", 2));
    await checkout(late);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, late));
    await paid((await paymentOf(late)).stripeSessionId);
    expect(await statusOf(late)).toBe("confirmed");
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  test("a missing signature is refused; unknown events and unknown sessions are acknowledged without effect", async () => {
    const payload = JSON.stringify({ id: "evt_x", object: "event", type: "checkout.session.completed", data: { object: {} } });
    const unsigned = await app.handle(
      new Request("http://localhost/api/payment/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: payload }),
    );
    expect(unsigned.status).toBe(400);
    expect((await json(unsigned)).code).toBe("INVALID_SIGNATURE");

    expect((await webhook("customer.created", { id: "cus_x", object: "customer" })).status).toBe(200);
    expect((await paid("cs_test_never_created")).status).toBe(200);
    expect((await webhook("checkout.session.expired", { id: "cs_test_never_created", payment_status: "unpaid" })).status).toBe(200);
    expect(enqueueMail).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  test("an expired event delivered after the payment completed changes nothing", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    const { stripeSessionId } = await paymentOf(id);
    await paid(stripeSessionId);
    enqueueMail.mockClear();

    expect((await webhook("checkout.session.expired", { id: stripeSessionId, payment_status: "unpaid" })).status).toBe(200);
    expect((await webhook("checkout.session.async_payment_failed", { id: stripeSessionId, payment_status: "unpaid" })).status).toBe(200);
    expect(await statusOf(id)).toBe("confirmed");
    expect((await paymentOf(id)).status).toBe("paid");
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("a failed delayed payment ends a seat hold, frees its seats, and leaves an approval's deadline alone", async () => {
    const type = await ticketType("first_come", 2);
    const held = await enrollment(type);
    await checkout(held);
    const { stripeSessionId } = await paymentOf(held);
    await webhook("checkout.session.completed", { id: stripeSessionId, payment_status: "unpaid", payment_intent: "pi_test" });
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(2);
    await webhook("checkout.session.async_payment_failed", { id: stripeSessionId, payment_status: "unpaid" });
    expect(await statusOf(held)).toBe("expired");
    expect((await paymentOf(held)).status).toBe("expired");
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(0);
    expect(enqueueMail).not.toHaveBeenCalled();

    const approved = await enrollment(await ticketType("approval"), { expiresInMs: 72 * 3_600_000 });
    await checkout(approved);
    await webhook("checkout.session.async_payment_failed", { id: (await paymentOf(approved)).stripeSessionId, payment_status: "unpaid" });
    expect(await statusOf(approved)).toBe("awaiting_payment");
  });

  test("a second paid session for one order is refunded as a duplicate; the order stays confirmed and is mailed once", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    // the first session is about to end, so the buyer gets a second one
    await db.update(payments).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(payments.enrollmentId, id));
    await checkout(id);
    expect(sessionsCreate).toHaveBeenCalledTimes(2);
    const [first, second] = await paymentsOf(id);

    await webhook("checkout.session.completed", { id: first!.stripeSessionId, payment_status: "paid", payment_intent: "pi_first" });
    expect(await statusOf(id)).toBe("confirmed");
    enqueueMail.mockClear();
    await webhook("checkout.session.completed", { id: second!.stripeSessionId, payment_status: "paid", payment_intent: "pi_second" });

    expect(await statusOf(id)).toBe("confirmed");
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(refundsCreate.mock.calls[0]![0]).toMatchObject({ payment_intent: "pi_second", amount: 60_000 });
    expect((await paymentsOf(id)).map((p) => p.status)).toEqual(["paid", "refunded"]);
    const [refund] = await db.select().from(refunds).where(eq(refunds.paymentId, second!.id));
    expect(refund).toMatchObject({ initiatedBy: "system", note: "duplicate", percent: 100 });
    // no second round of ticket mail, just the refund notice
    expect(enqueueMail.mock.calls.map(([m]) => m.template)).toEqual(["refund-system"]);
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ props: { reason: "duplicate" } });
  });

  test("an ended session doesn't end the order while a newer session of it is still open", async () => {
    const type = await ticketType("first_come", 5);
    const id = await enrollment(type);
    await checkout(id);
    // the first session is about to end, so the buyer gets a second one
    await db.update(payments).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(payments.enrollmentId, id));
    await checkout(id);
    expect(sessionsCreate).toHaveBeenCalledTimes(2);
    const [first, second] = await paymentsOf(id);

    await webhook("checkout.session.expired", { id: first!.stripeSessionId, payment_status: "unpaid" });
    expect((await paymentsOf(id)).map((p) => p.status)).toEqual(["expired", "pending"]);
    expect(await statusOf(id)).toBe("awaiting_payment");
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(2);

    await webhook("checkout.session.completed", { id: second!.stripeSessionId, payment_status: "paid", payment_intent: "pi_second" });
    expect(await statusOf(id)).toBe("confirmed");
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  test("the webhook and the buyer's check arriving together confirm once", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    const { stripeSessionId } = await paymentOf(id);
    sessionStates.set(stripeSessionId, { status: "complete", payment_status: "paid", payment_intent: "pi_test" });
    enqueueMail.mockClear();

    const [hook, check] = await Promise.all([paid(stripeSessionId), verify(id)]);
    expect([hook.status, check.status]).toEqual([200, 200]);
    expect(await statusOf(id)).toBe("confirmed");
    expect(enqueueMail).toHaveBeenCalledTimes(2);
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  test("an approval order past its payment deadline can't start a session, but a payment already on its way confirms it", async () => {
    const id = await enrollment(await ticketType("approval"), { expiresInMs: 72 * 3_600_000 });
    await checkout(id);
    const { stripeSessionId } = await paymentOf(id);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, id));
    await db.update(payments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(payments.enrollmentId, id));
    expect((await json(await checkout(id))).code).toBe("ENROLLMENT_CLOSED");

    // approval tickets have no seats to lose, so the money is kept and the order confirmed
    await paid(stripeSessionId);
    expect(await statusOf(id)).toBe("confirmed");
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});

describe("repeated actions and access", () => {
  test("two checkouts at once make one session", async () => {
    const id = await enrollment(await ticketType());
    const [a, b] = await Promise.all([checkout(id), checkout(id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await json(a)).url).toBe((await json(b)).url);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect(await paymentsOf(id)).toHaveLength(1);
  });

  test("a signed-out caller is refused, and another account can't see the order", async () => {
    const id = await enrollment(await ticketType());
    for (const call of [checkout, verify]) {
      const response = await call(id, "nobody");
      expect(response.status).toBe(401);
      expect((await json(response)).code).toBe("UNAUTHORIZED");
      expect((await call(id, "other")).status).toBe(404);
    }
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(sessionsRetrieve).not.toHaveBeenCalled();
  });

  test("an unknown order is a 404", async () => {
    expect((await json(await checkout(crypto.randomUUID()))).code).toBe("ENROLLMENT_NOT_FOUND");
    expect((await json(await verify(crypto.randomUUID()))).code).toBe("ENROLLMENT_NOT_FOUND");
  });
});

describe("recovery", () => {
  test("the buyer's check finishes an order whose payment was claimed as paid but never confirmed", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    // the crash window of settlePaid: the process claimed the payment (pending -> paid) and died before confirming the order
    await db
      .update(payments)
      .set({ status: "paid", paidAt: new Date(), stripePaymentIntentId: "pi_test", recoveryNextAt: new Date(Date.now() - 1000) })
      .where(eq(payments.enrollmentId, id));
    expect(await statusOf(id)).toBe("awaiting_payment");
    enqueueMail.mockClear();

    // someone else's check does nothing
    expect((await verify(id, "other")).status).toBe(404);
    expect(await statusOf(id)).toBe("awaiting_payment");

    expect(await json(await verify(id))).toEqual({ status: "confirmed" });
    expect(await statusOf(id)).toBe("confirmed");
    expect(enqueueMail).toHaveBeenCalledTimes(2);

    // and checking again changes nothing and mails nothing
    expect(await json(await verify(id))).toEqual({ status: "confirmed" });
    expect(enqueueMail).toHaveBeenCalledTimes(2);
    expect((await paymentOf(id)).status).toBe("paid");
  });
});

describe("recovery claims", () => {
  test("a payment recovered by two checks at once is refunded once, with one refund row and one mail", async () => {
    const type = await ticketType("first_come", 2);
    const late = await enrollment(type);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, late));
    await enrollment(type, { status: "confirmed" });
    await strand(late);
    enqueueMail.mockClear();

    await Promise.all([verify(late), verify(late), verify(late)]);

    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(await refundsOf(late)).toHaveLength(1);
    expect(mailsTo()).toEqual(["refund-system"]);
    expect((await paymentOf(late)).status).toBe("refunded");
  });

  test("a payment still being settled (claimed minutes ago, not hours) is left to the process that claimed it", async () => {
    const id = await enrollment(await ticketType());
    const row = await strand(id, { agoMs: MIN, paidAgoMs: MIN });
    enqueueMail.mockClear();

    expect(await json(await verify(id))).toEqual({ status: "awaiting_payment" });
    expect(await reconcilePaid({ only: [id] })).toMatchObject({ recovered: 0 });
    expect(await statusOf(id)).toBe("awaiting_payment");
    expect(enqueueMail).not.toHaveBeenCalled();

    // once the claim is old enough that its process can't still be running, it's finished
    await ageLease(row.id);
    expect(await json(await verify(id))).toEqual({ status: "confirmed" });
  });
});

describe("two paid sessions of one order", () => {
  test.each([
    ["the earlier one is stored first", false],
    ["the earlier one is stored second", true],
  ])("both stranded, recovered at once: the earlier confirms the order and only the later is refunded (%s)", async (_name, laterFirst) => {
    const id = await enrollment(await ticketType());
    const make = (intent: string, paidAgoMs: number) => strand(id, { intent, paidAgoMs });
    const rows = laterFirst
      ? [await make("pi_late", 20 * MIN), await make("pi_early", 30 * MIN)]
      : [await make("pi_early", 30 * MIN), await make("pi_late", 20 * MIN)];
    const early = rows.find((r) => r.stripePaymentIntentId === "pi_early")!;
    const late = rows.find((r) => r.stripePaymentIntentId === "pi_late")!;
    enqueueMail.mockClear();

    await Promise.all([reconcilePaid({ only: [id] }), reconcilePaid({ only: [id] }), verify(id)]);

    expect(await statusOf(id)).toBe("confirmed");
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(refundsCreate.mock.calls[0]![0]).toMatchObject({ payment_intent: "pi_late", amount: 60_000 });
    const byId = new Map((await paymentsOf(id)).map((p) => [p.id, p.status]));
    expect(byId.get(early.id)).toBe("paid");
    expect(byId.get(late.id)).toBe("refunded");
    const refund = (await refundsOf(id))[0]!;
    expect(refund).toMatchObject({ paymentId: late.id, note: "duplicate", initiatedBy: "system" });
    expect(mailsTo().sort()).toEqual(["refund-system", "ticket", "ticket"]);
  });
});

describe("reconciler", () => {
  test("finishes a stranded paid order without the buyer, once, and a delayed event can't undo it", async () => {
    const id = await enrollment(await ticketType());
    const row = await strand(id);
    enqueueMail.mockClear();

    expect(await reconcilePaid({ only: [id] })).toMatchObject({ recovered: 1, review: 0, failed: 0 });
    expect(await statusOf(id)).toBe("confirmed");
    expect(mailsTo()).toEqual(["ticket", "ticket"]);

    // run again, and again at once: nothing new
    await ageLease(row.id);
    const runs = await Promise.all([reconcilePaid({ only: [id] }), reconcilePaid({ only: [id] })]);
    expect(runs.map((r) => r.recovered)).toEqual([0, 0]);
    expect(mailsTo()).toEqual(["ticket", "ticket"]);
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);

    // Stripe delivering older news about the same session afterwards changes nothing
    await webhook("checkout.session.expired", { id: row.stripeSessionId });
    await webhook("checkout.session.async_payment_failed", { id: row.stripeSessionId });
    expect(await statusOf(id)).toBe("confirmed");
    expect((await paymentOf(id)).status).toBe("paid");
  });

  test("several recoveries racing the webhook and a buyer's check confirm the order once", async () => {
    const id = await enrollment(await ticketType());
    await checkout(id);
    const [open] = await paymentsOf(id);
    // the webhook claimed the session long ago and died; Stripe's retry, a check and two reconcilers all arrive now
    await db.update(payments).set({ status: "paid", paidAt: new Date(), stripePaymentIntentId: "pi_test", recoveryNextAt: new Date(Date.now() - 1000) }).where(eq(payments.id, open!.id));
    enqueueMail.mockClear();

    await Promise.all([
      paid(open!.stripeSessionId),
      verify(id),
      reconcilePaid({ only: [id] }),
      reconcilePaid({ only: [id] }),
    ]);

    expect(await statusOf(id)).toBe("confirmed");
    expect(mailsTo()).toEqual(["ticket", "ticket"]);
    expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  test("a lapsed hold follows the existing rule: confirmed if the seats are free, refunded if they went", async () => {
    const type = await ticketType("first_come", 4, 10);
    const free = await enrollment(type);
    const gone = await enrollment(type);
    for (const id of [free, gone]) await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, id));
    // someone else holds two of the four seats; the older payment (`free`) is settled first and takes the other two
    await enrollment(type, { status: "confirmed", quantity: 2 });
    await strand(free, { paidAgoMs: 20 * MIN });
    await strand(gone, { paidAgoMs: 10 * MIN });
    enqueueMail.mockClear();

    expect(await reconcilePaid({ only: [free, gone] })).toMatchObject({ recovered: 2, failed: 0, review: 0 });
    expect(await statusOf(free)).toBe("confirmed");
    expect(await statusOf(gone)).toBe("expired");
    expect((await paymentOf(gone)).status).toBe("refunded");
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(await refundsOf(free)).toEqual([]);
    expect(await seatsTaken(db, type.ticketTypeId)).toBe(4);
  });

  test("a late payment that would take the buyer past the ticket limit is neither confirmed nor refunded: it waits for a person", async () => {
    const type = await ticketType("first_come", 10, 3);
    const late = await enrollment(type);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, late));
    // the buyer ordered again after the hold lapsed: 2 + 2 tickets against a limit of 3
    await enrollment(type);
    const row = await strand(late);
    enqueueMail.mockClear();
    const errors = mock(() => {});
    const original = console.error;
    console.error = errors;
    try {
      expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 0, review: 1, failed: 0 });
      // and it isn't looked at again, so no loop of logs or calls
      await ageLease(row.id);
      expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 0, review: 0, failed: 0 });
      // buyer's own check leaves it too
      await verify(late);
    } finally {
      console.error = original;
    }
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain("pi_test");
    expect(await statusOf(late)).toBe("awaiting_payment");
    expect((await paymentOf(late)).status).toBe("paid");
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(await refundsOf(late)).toEqual([]);
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("the webhook meets the same limit: it acknowledges the event and keeps the payment, unconfirmed and unrefunded", async () => {
    const type = await ticketType("first_come", 10, 3);
    const late = await enrollment(type);
    await checkout(late);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, late));
    await enrollment(type);
    const started = Date.now();
    enqueueMail.mockClear();
    const original = console.error;
    console.error = () => {};
    try {
      expect((await paid((await paymentOf(late)).stripeSessionId)).status).toBe(200);
    } finally {
      console.error = original;
    }
    const payment = await paymentOf(late);
    expect(payment.status).toBe("paid");
    // the claim started its lease, so a reconciler leaves it alone for now
    expect(payment.recoveryNextAt!.getTime()).toBeGreaterThan(started);
    expect(await statusOf(late)).toBe("awaiting_payment");
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("a payment Stripe keeps refusing to refund is retried with growing backoff, then held; the state is in the row and a person can resume it", async () => {
    const type = await ticketType("first_come", 2);
    const late = await enrollment(type);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, late));
    await enrollment(type, { status: "confirmed" });
    const row = await strand(late);
    refundsCreate.mockImplementation(async () => {
      throw new Stripe.errors.StripeInvalidRequestError({ message: "charge_expired_for_refund" });
    });
    const original = console.error;
    console.error = () => {};
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const before = Date.now();
        expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 0, failed: 1 });
        const stored = await paymentOf(late);
        // kept in the row: the count, and when the next attempt may start, further out each time
        expect(stored.recoveryAttempts).toBe(attempt);
        expect(stored.recoveryNextAt!.getTime()).toBeGreaterThanOrEqual(before + backoffMs(attempt) - 1000);
        // straight away again: not before then
        expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 0, failed: 0 });
        await ageLease(row.id);
      }
      expect(refundsCreate).toHaveBeenCalledTimes(MAX_ATTEMPTS);
      expect((await paymentOf(late)).recoveryHold).toBe("exhausted");
      // held: however often it runs, and for the buyer's own check too
      expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 0, failed: 0 });
      await verify(late);
      expect(refundsCreate).toHaveBeenCalledTimes(MAX_ATTEMPTS);

      // once someone has dealt with the cause it is tried again, with the counter started over, and finishes
      refundsCreate.mockReset();
      refundsCreate.mockImplementation(async () => ({ id: `re_test_${crypto.randomUUID()}`, status: "succeeded" }));
      expect(await resumePayment(row.id)).toBe(true);
      expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 1 });
    } finally {
      console.error = original;
      refundsCreate.mockReset();
      refundsCreate.mockImplementation(async () => ({ id: `re_test_${crypto.randomUUID()}`, status: "succeeded" }));
    }
    expect((await paymentOf(late)).status).toBe("refunded");
    expect(await statusOf(late)).toBe("expired");
  });

  test("one payment that keeps failing doesn't hold up the others in its batch", async () => {
    const type = await ticketType("first_come", 6, 10);
    const bad = await enrollment(type);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, bad));
    await enrollment(type, { status: "confirmed", quantity: 5 });
    await strand(bad, { paidAgoMs: 40 * MIN });
    const good = await enrollment(await ticketType());
    await strand(good, { paidAgoMs: 10 * MIN });
    refundsCreate.mockImplementationOnce(async () => {
      throw new Stripe.errors.StripeConnectionError({ message: "down" });
    });
    const original = console.error;
    console.error = () => {};
    let report;
    try {
      report = await reconcilePaid({ only: [bad, good] });
    } finally {
      console.error = original;
    }
    expect(report).toMatchObject({ recovered: 1, failed: 1 });
    expect(await statusOf(good)).toBe("confirmed");
    expect((await paymentOf(bad)).status).toBe("paid");
  });

  test("a payment that waits between attempts: one the lease still covers is not retried early", async () => {
    const type = await ticketType("first_come", 2);
    const late = await enrollment(type);
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, late));
    await enrollment(type, { status: "confirmed" });
    await strand(late);
    refundsCreate.mockImplementationOnce(async () => {
      throw new Stripe.errors.StripeConnectionError({ message: "down" });
    });
    const original = console.error;
    console.error = () => {};
    try {
      expect(await reconcilePaid({ only: [late] })).toMatchObject({ failed: 1 });
      // straight away again: the failed attempt's lease keeps it from being hammered
      expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 0, failed: 0 });
    } finally {
      console.error = original;
    }
    expect(refundsCreate).toHaveBeenCalledTimes(1);
  });

  test("leaves everything it can't be sure about alone, and reports the odd ones", async () => {
    const type = await ticketType();
    const pending = await enrollment(type);
    await strand(pending, { status: "pending" });
    const expiredSession = await enrollment(type);
    await strand(expiredSession, { status: "expired" });
    const refunded = await enrollment(type);
    await strand(refunded, { status: "refunded" });
    const confirmed = await enrollment(type, { status: "confirmed" });
    await strand(confirmed);
    const approval = await enrollment(type, { status: "pending" });
    await strand(approval);
    const withRefund = await enrollment(type);
    const odd = await strand(withRefund);
    await db.insert(refunds).values({ enrollmentId: withRefund, paymentId: odd.id, amount: "600.00", percent: 100, status: "requires_action", initiatedBy: "system", note: "unavailable" });
    const ids = [pending, expiredSession, refunded, confirmed, approval, withRefund];
    enqueueMail.mockClear();
    const before = await db.select({ id: payments.id, status: payments.status }).from(payments).where(inArray(payments.enrollmentId, ids)).orderBy(asc(payments.id));
    const original = console.error;
    console.error = () => {};
    let report;
    try {
      report = await reconcilePaid({ only: ids });
    } finally {
      console.error = original;
    }

    expect(report).toMatchObject({ recovered: 0, review: 0, failed: 0 });
    // paid, yet its order still waits for approval, or a refund exists but the payment still says paid: for a person to look at
    expect(report.ambiguous).toBe(2);
    expect(await db.select({ id: payments.id, status: payments.status }).from(payments).where(inArray(payments.enrollmentId, ids)).orderBy(asc(payments.id))).toEqual(before);
    expect(await statusOf(approval)).toBe("pending");
    expect(await statusOf(pending)).toBe("awaiting_payment");
    expect(enqueueMail).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(sessionsRetrieve).not.toHaveBeenCalled();
  });

  test("a duplicate left unrefunded when the process died after the first payment confirmed the order is refunded", async () => {
    const id = await enrollment(await ticketType());
    await strand(id, { intent: "pi_first", paidAgoMs: 30 * MIN });
    const second = await strand(id, { intent: "pi_second", paidAgoMs: 20 * MIN });
    // the first one was finished (it confirmed the order); the second's refund never ran
    await db.update(enrollments).set({ status: "confirmed", expiresAt: null, confirmedAt: new Date() }).where(eq(enrollments.id, id));
    enqueueMail.mockClear();

    const runs = await Promise.all([reconcilePaid({ only: [id] }), reconcilePaid({ only: [id] })]);

    expect(runs.reduce((n, r) => n + r.recovered, 0)).toBe(1);
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(refundsCreate.mock.calls[0]![0]).toMatchObject({ payment_intent: "pi_second", amount: 60_000 });
    expect((await paymentsOf(id)).map((p) => p.status).sort()).toEqual(["paid", "refunded"]);
    expect((await refundsOf(id))[0]).toMatchObject({ paymentId: second.id, note: "duplicate" });
    expect(await statusOf(id)).toBe("confirmed");
    expect(mailsTo()).toEqual(["refund-system"]);
  });

  test("a paid payment of an order cancelled meanwhile is refunded, as the webhook would, and the order stays cancelled", async () => {
    const id = await enrollment(await ticketType(), { status: "cancelled" });
    await strand(id);

    expect(await reconcilePaid({ only: [id] })).toMatchObject({ recovered: 1 });
    expect(await statusOf(id)).toBe("cancelled");
    expect((await paymentOf(id)).status).toBe("refunded");
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(mailsTo()).toEqual(["refund-system"]);
  });

  test("one run takes at most `limit` payments, oldest first; the rest wait for the next", async () => {
    const type = await ticketType("first_come", 10);
    const ids = [await enrollment(type), await enrollment(type), await enrollment(type)];
    await strand(ids[0]!, { paidAgoMs: 30 * MIN });
    await strand(ids[1]!, { paidAgoMs: 20 * MIN });
    await strand(ids[2]!, { paidAgoMs: 40 * MIN });

    expect(await reconcilePaid({ only: ids, limit: 2 })).toMatchObject({ recovered: 2 });
    expect(await Promise.all(ids.map(statusOf))).toEqual(["confirmed", "awaiting_payment", "confirmed"]);
    expect(await reconcilePaid({ only: ids, limit: 2 })).toMatchObject({ recovered: 1 });
    expect(await Promise.all(ids.map(statusOf))).toEqual(["confirmed", "confirmed", "confirmed"]);
  });

  test("the timer finishes a stranded order by itself, with nobody asking, and keeps passes from overlapping", async () => {
    const id = await enrollment(await ticketType());
    await strand(id);
    enqueueMail.mockClear();

    const stop = startReconciler({ intervalMs: 15, only: [id] });
    try {
      for (let waited = 0; (await statusOf(id)) !== "confirmed" && waited < 3000; waited += 20) await Bun.sleep(20);
      // let several more passes go by
      await Bun.sleep(100);
    } finally {
      await stop();
    }
    expect(await statusOf(id)).toBe("confirmed");
    expect(mailsTo()).toEqual(["ticket", "ticket"]);
    expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
  });

  test("it only reads the database: Stripe isn't asked anything", async () => {
    const id = await enrollment(await ticketType());
    await strand(id);
    await reconcilePaid({ only: [id] });
    expect(sessionsRetrieve).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
