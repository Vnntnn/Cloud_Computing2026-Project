import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthSession, Role } from "@app/auth-guard";
import type { MailMessage } from "@app/mail";
import { tmpdir } from "node:os";
import Stripe from "stripe";

// Refund claims, durable recovery, the ticket-mail outbox and missed webhooks. Stripe and the mail queue are stand-ins that
// keep a ledger of what they really did, so a test can tell "asked" from "made". Races are held open with a gate inside the
// Stripe stand-in, not with sleeps; a crash is the state it leaves behind, as in checkout.test.ts.
const enqueueMail = mock(async (_message: MailMessage) => {});
mock.module("@app/mail", () => ({ enqueueMail }));

const SECRET = "whsec_test_secret";
const realStripe = new Stripe("sk_test_placeholder");

// every refund Stripe really made; the idempotency keys it has seen
const made: Stripe.Refund[] = [];
const ledger = new Map<string, Stripe.Refund>();
const keysAsked: (string | undefined)[] = [];
// what the next refunds.create does: "unreached": the request never got there; "lost": Stripe made the refund but the answer
// never came back; "invalid": Stripe refused for good
const behaviours: ("unreached" | "lost" | "invalid")[] = [];
let gate: { reached: Promise<void>; release: () => void; open: Promise<void>; signal: () => void } | undefined;
let paidWith = "card";
// the status Stripe gives a refund when it is made
let nextRefundStatus: "succeeded" | "failed" | "canceled" = "succeeded";

/** The next refunds.create stops inside Stripe until `release()`; `reached` resolves once it's there. */
function holdNextCreate() {
  let signal!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => (signal = resolve));
  const open = new Promise<void>((resolve) => (release = resolve));
  gate = { reached, release, open, signal };
  return gate;
}

const refundsCreate = mock(async (params: Stripe.RefundCreateParams, options?: { idempotencyKey?: string }) => {
  keysAsked.push(options?.idempotencyKey);
  const behaviour = behaviours.shift();
  if (behaviour === "invalid") throw new Stripe.errors.StripeInvalidRequestError({ message: "charge_expired_for_refund" });
  if (behaviour === "unreached") throw new Stripe.errors.StripeConnectionError({ message: "down" });
  const seen = options?.idempotencyKey ? ledger.get(options.idempotencyKey) : undefined;
  if (seen) return seen;
  if (gate) {
    const held = gate;
    gate = undefined;
    held.signal();
    await held.open;
  }
  const refund = {
    id: `re_test_${crypto.randomUUID()}`,
    status: nextRefundStatus,
    payment_intent: params.payment_intent!,
    amount: params.amount!,
    metadata: params.metadata,
  } as Stripe.Refund;
  made.push(refund);
  if (options?.idempotencyKey) ledger.set(options.idempotencyKey, refund);
  if (behaviour === "lost") throw new Stripe.errors.StripeConnectionError({ message: "response lost" });
  return refund;
});
// refunds Stripe lists for a payment intent: what an earlier version of this service made without a key (see "mixed versions")
let listed: Stripe.Refund[] = [];
const refundsList = mock(async (params?: { payment_intent?: string }) => ({ data: listed.filter((r) => r.payment_intent === params?.payment_intent) }));
const chargesList = mock(async () => ({ data: [{ payment_method_details: { type: paidWith } }] }));
// what Stripe says about a session when asked; one not listed is still open
const sessionStates = new Map<string, Partial<Stripe.Checkout.Session>>();
let retrieveFails = false;
const sessionsRetrieve = mock(async (id: string) => {
  if (retrieveFails) throw new Stripe.errors.StripeConnectionError({ message: "down" });
  return { id, object: "checkout.session", status: "open", payment_status: "unpaid", payment_intent: null, ...sessionStates.get(id) };
});
mock.module("../src/libs/stripe", () => ({
  stripe: {
    checkout: { sessions: { retrieve: sessionsRetrieve } },
    charges: { list: chargesList },
    refunds: { create: refundsCreate, list: refundsList },
    webhooks: realStripe.webhooks,
  },
  webhookSecret: SECRET,
}));

const sessions = new Map<string, AuthSession>();
const resolve = async (headers: Headers) => sessions.get(headers.get("cookie") ?? "") ?? null;
const actual = { ...(await import("@app/auth-guard")) };
mock.module("@app/auth-guard", () => ({
  ...actual,
  authGuard: actual.createAuthGuard(resolve, "test"),
  authenticate: actual.createAuthenticator(resolve),
}));

const { payment: app } = await import("../src/app");
const { and, asc, db, enrollments, eq, eventCategories, events, inArray, isNull, payments, refunds, sql, notificationOutbox, ticketMailOutbox, tickets, ticketTypes, users } = await import("@app/db");
const { dispatchNotifications, dispatchTicketMails } = await import("@app/tickets");
const { heldRecords, reconcilePaid, reconcilePending, resumePayment, resumeRefunds } = await import("../src/libs/reconcile");
const { backoffMs, LEASE_MS } = await import("../src/libs/retry");
const MAX_POLL_ERRORS = 8;

const runId = crypto.randomUUID().slice(0, 8);
const userIds: Record<string, string> = {};
const eventIds: string[] = [];
let categoryId: string;
const MIN = 60_000;
const HOUR = 60 * MIN;
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
const organizerRefund = (enrollmentId: string, as = "owner") => request("POST", `/enrollments/${enrollmentId}/refund`, as, {});
const verify = (enrollmentId: string, as = "buyer") => request("POST", "/checkout/verify", as, { enrollmentId });

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

async function ticketType({ quota = 10, maxPerUser = 10 } = {}) {
  const [event] = await db
    .insert(events)
    .values({
      organizerId: userIds.owner!,
      categoryId,
      title: "Gala",
      slug: `gala-${crypto.randomUUID().slice(0, 12)}`,
      venue: "Hall",
      status: "public",
      startsAt: new Date(Date.now() + 48 * HOUR),
      endsAt: new Date(Date.now() + 52 * HOUR),
    })
    .returning({ id: events.id });
  eventIds.push(event!.id);
  const [type] = await db
    .insert(ticketTypes)
    .values({ eventId: event!.id, kind: "first_come", name: "VIP", price: "300.00", quota, maxPerUser })
    .returning({ id: ticketTypes.id });
  return { eventId: event!.id, ticketTypeId: type!.id };
}

type Status = "awaiting_payment" | "confirmed" | "cancelled";

/** The buyer's two-ticket order (฿600, 50% back until a day before the event). */
async function order(type: { eventId: string; ticketTypeId: string }, status: Status = "awaiting_payment", expiresInMs = 35 * MIN) {
  const [row] = await db
    .insert(enrollments)
    .values({
      ...type,
      buyerId: userIds.buyer,
      quantity: 2,
      unitPrice: "300.00",
      status,
      expiresAt: status === "awaiting_payment" ? new Date(Date.now() + expiresInMs) : null,
      confirmedAt: status === "confirmed" ? new Date() : null,
      refundPercent: 50,
      refundCutoffHours: 24,
    })
    .returning({ id: enrollments.id });
  await db.insert(tickets).values(
    [emailOf("buyer"), emailOf("guest")].map((email, i) => ({
      enrollmentId: row!.id,
      code: crypto.randomUUID().slice(0, 10).toUpperCase(),
      firstName: `Guest${i}`,
      lastName: "Tester",
      email,
    })),
  );
  return row!.id;
}

type PaymentOptions = { status?: "pending" | "paid"; paidAgoMs?: number; ageMs?: number; intent?: string; createdAgoMs?: number };

/** A session of the order: by default one paid `paidAgoMs` ago whose process died `ageMs` ago (past its lease). */
async function payment(enrollmentId: string, options: PaymentOptions = {}) {
  const { status = "paid", paidAgoMs = 30 * MIN, ageMs = 11 * MIN, intent = `pi_${crypto.randomUUID().slice(0, 8)}`, createdAgoMs = 40 * MIN } = options;
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
      stripePaymentIntentId: status === "paid" ? intent : null,
      paidAt: status === "paid" ? new Date(Date.now() - paidAgoMs) : null,
      recoveryNextAt: status === "paid" ? new Date(Date.now() - ageMs + LEASE_MS) : null,
      createdAt: new Date(Date.now() - createdAgoMs),
    })
    .returning();
  return row!;
}

/** A confirmed order whose accepted payment is `first`; `second` is paid for it too, and still unrefunded. */
async function orderWithDuplicate(type: { eventId: string; ticketTypeId: string }) {
  const id = await order(type, "confirmed");
  const first = await payment(id, { paidAgoMs: 40 * MIN, intent: "pi_first" });
  const second = await payment(id, { paidAgoMs: 20 * MIN, intent: "pi_second" });
  await db.update(enrollments).set({ acceptedPaymentId: first.id }).where(eq(enrollments.id, id));
  return { id, first, second };
}

const statusOf = async (id: string) => (await db.select({ status: enrollments.status }).from(enrollments).where(eq(enrollments.id, id)))[0]!.status;
const paymentOf = async (id: string) => (await db.select().from(payments).where(eq(payments.id, id)))[0]!;
const refundsOf = (enrollmentId: string) => db.select().from(refunds).where(eq(refunds.enrollmentId, enrollmentId)).orderBy(asc(refunds.createdAt));
/** The outbox rows of these orders' tickets only: the tests share the database with real orders, whose mail they must never touch. */
const outboxOfOrders = (...ids: string[]) =>
  inArray(ticketMailOutbox.ticketId, db.select({ id: tickets.id }).from(tickets).where(inArray(tickets.enrollmentId, ids)));
const mailsTo = (): string[] => enqueueMail.mock.calls.map(([m]) => m.template);
const quiet = async <T>(run: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
};

beforeAll(async () => {
  await seedUser("owner", "organizer");
  await seedUser("buyer", "user");
  await seedUser("other", "user");
  await seedUser("admin", "admin");
  const [category] = await db.insert(eventCategories).values({ name: `cat-rel-${runId}`, slug: `cat-rel-${runId}` }).returning({ id: eventCategories.id });
  categoryId = category!.id;
});

beforeEach(() => {
  paidWith = "card";
  nextRefundStatus = "succeeded";
  retrieveFails = false;
  gate = undefined;
  behaviours.length = 0;
  keysAsked.length = 0;
  made.length = 0;
  listed = [];
  ledger.clear();
  enqueueMail.mockReset();
  enqueueMail.mockImplementation(async () => {});
  refundsCreate.mockClear();
  sessionsRetrieve.mockClear();
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

describe("refund paths racing", () => {
  test.each([
    ["the buyer", buyerRefund, 50],
    ["the organizer", organizerRefund, 100],
  ])("%s refunding an order while its duplicate payment is being refunded: each payment is refunded once, the accepted one by the request", async (_who, ask, percent) => {
    const { id, first, second } = await orderWithDuplicate(await ticketType());
    // the duplicate's refund is held inside Stripe while the request comes in
    const held = holdNextCreate();
    const duplicate = reconcilePaid({ only: [id] });
    await held.reached;
    expect(made).toHaveLength(0);

    const response = await ask(id);
    held.release();
    await duplicate;

    expect(response.status).toBe(200);
    expect(made).toHaveLength(2);
    const byPayment = new Map((await refundsOf(id)).map((r) => [r.paymentId, r]));
    expect(byPayment.get(first.id)).toMatchObject({ percent, status: "succeeded" });
    expect(byPayment.get(second.id)).toMatchObject({ percent: 100, initiatedBy: "system", note: "duplicate", status: "succeeded" });
    expect(made.find((r) => r.payment_intent === "pi_first")!.amount).toBe(percent * 600);
    expect(made.find((r) => r.payment_intent === "pi_second")!.amount).toBe(60_000);
    expect(await statusOf(id)).toBe("cancelled");
    expect((await paymentOf(first.id)).status).toBe("refunded");
    expect((await paymentOf(second.id)).status).toBe("refunded");
    // each payment carries one refund, never more than it paid
    expect(byPayment.size).toBe(2);
  });

  test("a buyer asking while an unrefunded duplicate waits refunds the accepted payment, not whichever the database returns first", async () => {
    // the duplicate is stored first
    const type = await ticketType();
    const id = await order(type, "confirmed");
    const second = await payment(id, { paidAgoMs: 20 * MIN, intent: "pi_second" });
    const first = await payment(id, { paidAgoMs: 40 * MIN, intent: "pi_first" });
    await db.update(enrollments).set({ acceptedPaymentId: first.id }).where(eq(enrollments.id, id));

    expect((await buyerRefund(id)).status).toBe(200);

    expect(made.map((r) => r.payment_intent)).toEqual(["pi_first"]);
    expect((await paymentOf(first.id)).status).toBe("refunded");
    // the duplicate is left for its own refund, in full
    expect((await paymentOf(second.id)).status).toBe("paid");
    expect(await reconcilePaid({ only: [id] })).toMatchObject({ recovered: 1 });
    expect(made.map((r) => r.payment_intent).sort()).toEqual(["pi_first", "pi_second"]);
    // the order is cancelled by now, so the leftover payment is refunded as a late one would be
    expect((await refundsOf(id)).find((r) => r.paymentId === second.id)).toMatchObject({ percent: 100, initiatedBy: "system" });
  });

  test("two requests claiming one payment at once: the second finds the claim and is refused while the first is inside Stripe; Stripe is asked once", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    const held = holdNextCreate();

    const buyer = buyerRefund(id);
    await held.reached;
    const organizer = await organizerRefund(id);
    expect(organizer.status).toBe(409);
    expect((await json(organizer)).code).toBe("ALREADY_REFUNDED");
    // meanwhile the scheduler leaves the intent alone: its lease is live
    expect(await resumeRefunds({ only: [id] })).toMatchObject({ resumed: 0 });
    held.release();

    expect((await buyer).status).toBe(200);
    expect(made).toHaveLength(1);
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(await refundsOf(id)).toHaveLength(1);
    // repeated requests don't refund again
    expect((await buyerRefund(id)).status).toBe(409);
    expect((await organizerRefund(id)).status).toBe(409);
    expect(made).toHaveLength(1);
    expect(mailsTo().filter((t) => t === "order-cancelled").length).toBeGreaterThan(0);
  });

  test("partial and full requests at once give back at most what was paid: the first claim's percent stands", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    const held = holdNextCreate();
    const buyer = buyerRefund(id);
    await held.reached;
    const organizer = organizerRefund(id);
    held.release();
    const results = await Promise.all([buyer, organizer]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await refundsOf(id);
    expect(rows).toHaveLength(1);
    expect(made.reduce((sum, r) => sum + r.amount, 0)).toBeLessThanOrEqual(60_000);
    expect(Number(rows[0]!.amount)).toBe(300);
  });

  test("repeated webhooks and repeated requests: one refund", async () => {
    const { id, second } = await orderWithDuplicate(await ticketType());
    const session = (await db.update(payments).set({ status: "pending", recoveryNextAt: null }).where(eq(payments.id, second.id)).returning())[0]!;
    const paid = () => webhook("checkout.session.completed", { id: session.stripeSessionId, payment_status: "paid", payment_intent: "pi_second" });
    // the webhook of the duplicate arrives three times, one after another and at once
    expect((await paid()).status).toBe(200);
    await Promise.all([paid(), paid()]);
    expect(made.filter((r) => r.payment_intent === "pi_second")).toHaveLength(1);
    expect((await refundsOf(id)).filter((r) => r.paymentId === second.id)).toHaveLength(1);
    expect(mailsTo().filter((t) => t === "refund-system")).toHaveLength(1);
    // refund.updated redelivered doesn't change a succeeded refund
    const stripeId = (await refundsOf(id))[0]!.stripeRefundId!;
    for (let i = 0; i < 2; i++) await webhook("refund.updated", { id: stripeId, object: "refund", status: "pending", metadata: { paymentId: second.id } });
    expect((await refundsOf(id))[0]!.status).toBe("succeeded");
  });
});

describe("a refund Stripe made, an answer never recorded", () => {
  test("the answer is lost on the way back: the intent stays, the retry gets the same refund under the same key, and records it", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    behaviours.push("lost");

    const first = await quiet(() => buyerRefund(id));
    expect(first.status).toBe(503);
    // Stripe made it, we heard nothing: an unresolved intent, the order untouched, nobody mailed
    expect(made).toHaveLength(1);
    const [intent] = await refundsOf(id);
    expect(intent).toMatchObject({ status: "pending", stripeRefundId: null, percent: 50 });
    expect((await paymentOf(row.id)).status).toBe("paid");
    expect(await statusOf(id)).toBe("confirmed");
    expect(enqueueMail).not.toHaveBeenCalled();

    expect((await buyerRefund(id)).status).toBe(200);
    expect(made).toHaveLength(1);
    expect(new Set(keysAsked).size).toBe(1);
    expect(keysAsked[0]).toBe(`refund-${intent!.id}`);
    const [done] = await refundsOf(id);
    expect(done).toMatchObject({ id: intent!.id, status: "succeeded", stripeRefundId: made[0]!.id });
    expect((await paymentOf(row.id)).status).toBe("refunded");
    expect(await statusOf(id)).toBe("cancelled");
  });

  test("the process died after Stripe made it: a later run (a restarted replica) finds the intent and records the refund Stripe already made, mailing once", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    // what the crash left: the intent (its owner's lease ran out) and, at Stripe, the refund made under its key
    const [intent] = await db
      .insert(refunds)
      .values({ enrollmentId: id, paymentId: row.id, amount: "300.00", percent: 50, status: "pending", initiatedBy: "buyer", requestedBy: userIds.buyer, recoveryNextAt: new Date(Date.now() - 1000) })
      .returning();
    const lost = { id: "re_test_made_before_crash", status: "succeeded", payment_intent: row.stripePaymentIntentId, amount: 30_000, metadata: {} } as Stripe.Refund;
    ledger.set(`refund-${intent!.id}`, lost);
    made.push(lost);

    expect(await resumeRefunds({ only: [id] })).toMatchObject({ resumed: 1, failed: 0 });
    expect(made).toHaveLength(1);
    expect((await refundsOf(id))[0]).toMatchObject({ status: "succeeded", stripeRefundId: "re_test_made_before_crash" });
    expect((await paymentOf(row.id)).status).toBe("refunded");
    expect(await statusOf(id)).toBe("cancelled");
    expect(mailsTo().filter((t) => t === "order-cancelled").length).toBeGreaterThan(0);
    const mails = enqueueMail.mock.calls.length;
    expect(await resumeRefunds({ only: [id] })).toMatchObject({ resumed: 0 });
    expect(enqueueMail).toHaveBeenCalledTimes(mails);
  });

  test("the process died before asking Stripe: the resumed intent makes the refund once, under the key derived from its id", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    const [intent] = await db
      .insert(refunds)
      .values({ enrollmentId: id, paymentId: row.id, amount: "600.00", percent: 100, status: "pending", initiatedBy: "organizer", requestedBy: userIds.owner, recoveryNextAt: new Date(Date.now() - 1000) })
      .returning();

    await Promise.all([resumeRefunds({ only: [id] }), resumeRefunds({ only: [id] })]);

    expect(made).toHaveLength(1);
    expect(keysAsked).toEqual([`refund-${intent!.id}`]);
    expect((await refundsOf(id))[0]).toMatchObject({ status: "succeeded", stripeRefundId: made[0]!.id });
  });

  test("a refusal for good removes the intent, so the next attempt asks under a new key; an unanswered one keeps it and its key", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));

    behaviours.push("unreached");
    expect((await quiet(() => buyerRefund(id))).status).toBe(503);
    const [kept] = await refundsOf(id);
    behaviours.push("invalid");
    expect((await json(await quiet(() => buyerRefund(id)))).code).toBe("REFUND_REJECTED");
    expect(await refundsOf(id)).toEqual([]);
    expect((await buyerRefund(id)).status).toBe(200);

    expect(keysAsked[0]).toBe(`refund-${kept!.id}`);
    expect(keysAsked[1]).toBe(keysAsked[0]);
    expect(keysAsked[2]).not.toBe(keysAsked[0]);
    expect(made).toHaveLength(1);
  });

  test("a refund failing in the scheduler backs off and is held after the attempts, in the row", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    const [intent] = await db
      .insert(refunds)
      .values({ enrollmentId: id, paymentId: row.id, amount: "600.00", percent: 100, status: "pending", initiatedBy: "organizer", recoveryNextAt: new Date(Date.now() - 1000) })
      .returning();
    for (let attempt = 1; attempt <= 6; attempt++) {
      behaviours.push("unreached");
      expect(await quiet(() => resumeRefunds({ only: [id] }))).toMatchObject({ failed: 1 });
      const stored = (await refundsOf(id))[0]!;
      expect(stored.recoveryAttempts).toBe(attempt);
      expect(stored.recoveryNextAt!.getTime()).toBeGreaterThan(Date.now() + backoffMs(attempt) - 5000);
      // not again before then
      expect(await resumeRefunds({ only: [id] })).toMatchObject({ resumed: 0, failed: 0 });
      await db.update(refunds).set({ recoveryNextAt: new Date(Date.now() - 1000) }).where(eq(refunds.id, intent!.id));
    }
    expect((await refundsOf(id))[0]!.recoveryHold).toBe("exhausted");
    expect((await heldRecords({ enrollmentId: id })).refunds.map((r) => r.id)).toEqual([intent!.id]);
    expect(await resumeRefunds({ only: [id] })).toMatchObject({ resumed: 0, failed: 0 });
  });
});

describe("payment state racing a refund", () => {
  test("a refund left unanswered keeps its payment paid: the failed webhook is not allowed to release it, and the retry can't confirm the order", async () => {
    // a late payment (the hold lapsed, the seats went): refunded in full
    const type = await ticketType({ quota: 2 });
    const late = await order(type, "awaiting_payment", -1000);
    await order(type, "confirmed");
    const session = await payment(late, { status: "pending", createdAgoMs: 1 * MIN });
    behaviours.push("unreached");

    const paid = () => webhook("checkout.session.completed", { id: session.stripeSessionId, payment_status: "paid", payment_intent: "pi_late" });
    expect((await quiet(paid)).status).toBe(503);
    // the intent is recorded, the payment stays paid (it used to go back to pending), nothing else changed
    expect((await refundsOf(late))[0]).toMatchObject({ status: "pending", stripeRefundId: null });
    expect((await paymentOf(session.id)).status).toBe("paid");
    expect(await statusOf(late)).toBe("awaiting_payment");

    // Stripe delivers it again: nothing to claim any more
    expect((await paid()).status).toBe(200);
    expect(made).toHaveLength(0);
    // the intent is finished by the scheduler
    await db.update(refunds).set({ recoveryNextAt: new Date(Date.now() - 1000) }).where(eq(refunds.enrollmentId, late));
    expect(await resumeRefunds({ only: [late] })).toMatchObject({ resumed: 1 });
    expect(made).toHaveLength(1);
    expect((await paymentOf(session.id)).status).toBe("refunded");
    expect(await statusOf(late)).toBe("expired");
    expect(mailsTo()).toEqual(["refund-system"]);
  });

  test("a refusal for good before anything is recorded still releases the payment, so Stripe's retry runs the whole step again", async () => {
    const type = await ticketType({ quota: 2 });
    const late = await order(type, "awaiting_payment", -1000);
    await order(type, "confirmed");
    const session = await payment(late, { status: "pending", createdAgoMs: 1 * MIN });
    behaviours.push("invalid");
    const paid = () => webhook("checkout.session.completed", { id: session.stripeSessionId, payment_status: "paid", payment_intent: "pi_late" });

    expect((await quiet(paid)).status).toBe(422);
    const released = await paymentOf(session.id);
    expect(released.status).toBe("pending");
    // it keeps its place among the order's payments
    expect(released.paidAt).not.toBeNull();
    expect(await refundsOf(late)).toEqual([]);
    expect((await paid()).status).toBe(200);
    expect((await paymentOf(session.id)).status).toBe("refunded");
    expect(made).toHaveLength(1);
  });

  test("a payment released while a second is confirmed: the confirmed one stays accepted and the released one, paid again, is the duplicate (both refunded and neither confirmed was the old outcome)", async () => {
    const id = await order(await ticketType());
    const first = await payment(id, { status: "pending", createdAgoMs: 40 * MIN });
    const second = await payment(id, { status: "pending", createdAgoMs: 30 * MIN });
    // the first was claimed (paid_at kept), failed and released; the second is paid and settles meanwhile
    await db.update(payments).set({ paidAt: new Date(Date.now() - 30 * MIN) }).where(eq(payments.id, first.id));
    const paid = (row: typeof first, intent: string) => webhook("checkout.session.completed", { id: row.stripeSessionId, payment_status: "paid", payment_intent: intent });
    expect((await paid(second, "pi_second")).status).toBe(200);
    expect(await statusOf(id)).toBe("confirmed");
    expect((await db.select().from(enrollments).where(eq(enrollments.id, id)))[0]!.acceptedPaymentId).toBe(second.id);
    // and now the first comes back
    expect((await paid(first, "pi_first")).status).toBe(200);

    expect((await paymentOf(first.id)).status).toBe("refunded");
    expect((await paymentOf(second.id)).status).toBe("paid");
    expect(made.map((r) => r.payment_intent)).toEqual(["pi_first"]);
    expect(await statusOf(id)).toBe("confirmed");
    expect(mailsTo().filter((t) => t === "ticket")).toHaveLength(2);
  });

  test("two paid sessions settling at once: exactly one is accepted, however they interleave, and only the other is refunded", async () => {
    for (let round = 0; round < 3; round++) {
      const id = await order(await ticketType());
      const a = await payment(id, { status: "pending", createdAgoMs: 40 * MIN });
      const b = await payment(id, { status: "pending", createdAgoMs: 30 * MIN });
      const paid = (row: typeof a, intent: string) => webhook("checkout.session.completed", { id: row.stripeSessionId, payment_status: "paid", payment_intent: intent });
      await Promise.all([paid(a, `pi_a${round}`), paid(b, `pi_b${round}`)]);

      const rows = await db.select().from(payments).where(eq(payments.enrollmentId, id));
      const accepted = (await db.select().from(enrollments).where(eq(enrollments.id, id)))[0]!.acceptedPaymentId;
      expect(await statusOf(id)).toBe("confirmed");
      expect(rows.filter((r) => r.status === "paid").map((r) => r.id)).toEqual([accepted!]);
      expect(rows.filter((r) => r.status === "refunded")).toHaveLength(1);
      expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
    }
  });
});

describe("paid_at and the winner of two payments", () => {
  test("the database refuses a paid payment without paid_at (older rows aren't checked)", async () => {
    const id = await order(await ticketType());
    const row = await payment(id, { status: "pending" });
    await expect((async () => void (await db.update(payments).set({ status: "paid" }).where(eq(payments.id, row.id))))()).rejects.toThrow();
    expect((await paymentOf(row.id)).status).toBe("pending");
  });

  test("equal paid_at: the lower id is the earlier, whatever order the rows were stored or recovered in", async () => {
    const id = await order(await ticketType());
    const at = new Date(Date.now() - 30 * MIN);
    const rows = [await payment(id), await payment(id)];
    await db.update(payments).set({ paidAt: at }).where(eq(payments.enrollmentId, id));
    const [low, high] = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));

    await Promise.all([reconcilePaid({ only: [id] }), reconcilePaid({ only: [id] })]);

    expect((await paymentOf(low!.id)).status).toBe("paid");
    expect((await paymentOf(high!.id)).status).toBe("refunded");
    expect((await db.select().from(enrollments).where(eq(enrollments.id, id)))[0]!.acceptedPaymentId).toBe(low!.id);
  });

  test("a legacy order confirmed before the accepted payment was recorded keeps its behaviour: its first payment is done, a later one is the duplicate", async () => {
    const id = await order(await ticketType(), "confirmed");
    const first = await payment(id, { paidAgoMs: 40 * MIN });
    const second = await payment(id, { paidAgoMs: 20 * MIN });
    expect((await db.select().from(enrollments).where(eq(enrollments.id, id)))[0]!.acceptedPaymentId).toBeNull();
    expect(await reconcilePaid({ only: [id] })).toMatchObject({ recovered: 1 });
    expect((await paymentOf(first.id)).status).toBe("paid");
    expect((await paymentOf(second.id)).status).toBe("refunded");
  });

  test.skipIf(!/mig_phase\d+$/.test(process.env.DATABASE_URL ?? ""))("a legacy paid row without paid_at (the constraint is NOT VALID, so old rows can exist) is held as inconsistent, never ranked or settled (scratch database only: it needs the check dropped)", async () => {
    await db.execute(sql`alter table payments drop constraint payments_paid_at_check`);
    try {
      const id = await order(await ticketType());
      const row = await payment(id);
      await db.update(payments).set({ paidAt: null }).where(eq(payments.id, row.id));
      expect(await quiet(() => reconcilePaid({ only: [id] }))).toMatchObject({ recovered: 0, ambiguous: 1 });
      expect((await paymentOf(row.id)).recoveryHold).toBe("inconsistent");
      // held, it is left alone, by the buyer's check as well
      await verify(id);
      expect(await quiet(() => reconcilePaid({ only: [id] }))).toMatchObject({ recovered: 0, ambiguous: 0 });
      expect(await statusOf(id)).toBe("awaiting_payment");
      expect(made).toHaveLength(0);
      await db.update(payments).set({ status: "pending", recoveryHold: null }).where(eq(payments.id, row.id));
    } finally {
      await db.execute(sql`alter table payments add constraint payments_paid_at_check check (status not in ('paid', 'refunded') or paid_at is not null or recovery_hold is not null) not valid`);
    }
  });
});

describe("held for a person", () => {
  test("a paid order over the ticket limit is held in the row: not retried, no tickets mailed, listed for admins, resumable once the cause is gone", async () => {
    const type = await ticketType({ maxPerUser: 3 });
    const late = await order(type, "awaiting_payment", -1000);
    await order(type, "awaiting_payment");
    const row = await payment(late);
    enqueueMail.mockClear();

    expect(await quiet(() => reconcilePaid({ only: [late] }))).toMatchObject({ recovered: 0, review: 1 });
    expect((await paymentOf(row.id)).recoveryHold).toBe("over_limit");
    expect(await quiet(() => reconcilePaid({ only: [late] }))).toMatchObject({ recovered: 0, review: 0, failed: 0 });
    await verify(late);
    expect(await statusOf(late)).toBe("awaiting_payment");
    expect(await db.$count(ticketMailOutbox, sql`${ticketMailOutbox.ticketId} in (select id from tickets where enrollment_id = ${late})`)).toBe(0);
    expect(enqueueMail).not.toHaveBeenCalled();
    expect(made).toHaveLength(0);

    // admins see it, others don't
    expect((await request("GET", "/recovery/held", "buyer")).status).toBe(403);
    expect((await request("GET", "/recovery/held", "nobody")).status).toBe(401);
    const held = await json(await request("GET", `/recovery/held?enrollmentId=${late}`, "admin"));
    expect(held.payments).toEqual([expect.objectContaining({ id: row.id, hold: "over_limit", enrollmentId: late })]);
    expect(JSON.stringify(held)).not.toContain("pi_");

    // resumed while still over: held again, nothing else happens
    expect((await request("POST", `/recovery/payments/${row.id}/resume`, "buyer")).status).toBe(403);
    expect(await json(await request("POST", `/recovery/payments/${row.id}/resume`, "admin"))).toEqual({ resumed: true });
    expect(await quiet(() => reconcilePaid({ only: [late] }))).toMatchObject({ review: 1 });
    expect((await paymentOf(row.id)).recoveryHold).toBe("over_limit");

    // once the limit allows it, it is confirmed, with its tickets mailed once
    await db.update(ticketTypes).set({ maxPerUser: 4 }).where(eq(ticketTypes.id, type.ticketTypeId));
    expect(await resumePayment(row.id)).toBe(true);
    expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 1 });
    expect(await statusOf(late)).toBe("confirmed");
    expect(mailsTo()).toEqual(["ticket", "ticket"]);
    expect(await resumePayment(row.id)).toBe(false);
  });

  test("a payment that already has a refund yet still says paid is held as inconsistent, not touched", async () => {
    const id = await order(await ticketType());
    const row = await payment(id);
    await db.insert(refunds).values({ enrollmentId: id, paymentId: row.id, amount: "600.00", percent: 100, status: "requires_action", initiatedBy: "system", note: "unavailable" });
    expect(await quiet(() => reconcilePaid({ only: [id] }))).toMatchObject({ ambiguous: 1, recovered: 0 });
    expect((await paymentOf(row.id)).recoveryHold).toBe("inconsistent");
    expect(await statusOf(id)).toBe("awaiting_payment");
    expect(made).toHaveLength(0);
  });
});

describe("missed webhooks", () => {
  const retrieve = (row: { stripeSessionId: string }, session: Partial<Stripe.Checkout.Session>) => sessionStates.set(row.stripeSessionId, session);

  test("a pending payment the webhook never settled is settled from Stripe's answer, as the webhook would, once", async () => {
    const id = await order(await ticketType());
    const row = await payment(id, { status: "pending", createdAgoMs: 20 * MIN });
    retrieve(row, { status: "complete", payment_status: "paid", payment_intent: "pi_missed" });

    const runs = await Promise.all([reconcilePending({ only: [id] }), reconcilePending({ only: [id] })]);
    // and the webhook arrives late as well
    await webhook("checkout.session.completed", { id: row.stripeSessionId, payment_status: "paid", payment_intent: "pi_missed" });

    expect(runs.reduce((n, r) => n + r.settled, 0)).toBe(1);
    expect(sessionsRetrieve).toHaveBeenCalledTimes(1);
    expect(await statusOf(id)).toBe("confirmed");
    expect(mailsTo()).toEqual(["ticket", "ticket"]);
    expect((await paymentOf(row.id)).stripePaymentIntentId).toBe("pi_missed");
    expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
    // settled: never asked about again
    sessionsRetrieve.mockClear();
    expect(await reconcilePending({ only: [id] })).toMatchObject({ settled: 0, waiting: 0 });
    expect(sessionsRetrieve).not.toHaveBeenCalled();
  });

  test("an expired session ends the hold; an open one is asked again when it ends; a delayed method waits; a recent one and a failed lookup are left to backoff", async () => {
    const type = await ticketType();
    const expired = await order(type);
    const open = await order(type);
    const delayed = await order(type);
    const recent = await order(type);
    const broken = await order(type);
    const rows = {
      expired: await payment(expired, { status: "pending", createdAgoMs: 20 * MIN }),
      open: await payment(open, { status: "pending", createdAgoMs: 20 * MIN }),
      delayed: await payment(delayed, { status: "pending", createdAgoMs: 20 * MIN }),
      recent: await payment(recent, { status: "pending", createdAgoMs: 2 * MIN }),
      broken: await payment(broken, { status: "pending", createdAgoMs: 20 * MIN }),
    };
    retrieve(rows.expired, { status: "expired" });
    retrieve(rows.delayed, { status: "complete", payment_status: "unpaid" });
    const ids = [expired, open, delayed, recent, broken];
    sessionsRetrieve.mockImplementation(async (sessionId: string) => {
      if (sessionId === rows.broken.stripeSessionId) throw new Stripe.errors.StripeConnectionError({ message: "down" });
      return { id: sessionId, object: "checkout.session", status: "open", payment_status: "unpaid", payment_intent: null, ...sessionStates.get(sessionId) } as any;
    });

    const report = await quiet(() => reconcilePending({ only: ids }));
    expect(report).toMatchObject({ settled: 1, waiting: 2, failed: 1 });
    expect(await statusOf(expired)).toBe("expired");
    expect((await paymentOf(rows.expired.id)).status).toBe("expired");
    for (const id of [open, delayed, recent, broken]) expect(await statusOf(id)).toBe("awaiting_payment");
    expect(sessionsRetrieve.mock.calls.map(([id]) => id)).not.toContain(rows.recent.stripeSessionId);
    // when to look again is in the rows
    const next = async (row: { id: string }) => (await paymentOf(row.id)).recoveryNextAt!.getTime();
    expect(await next(rows.delayed)).toBeGreaterThan(Date.now() + 25 * MIN);
    expect(await next(rows.open)).toBeGreaterThan(Date.now() + 4 * MIN);
    const broke = await paymentOf(rows.broken.id);
    expect(broke.recoveryAttempts).toBe(1);
    expect(broke.recoveryNextAt!.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 5000);
    // straight away again: nothing is asked
    sessionsRetrieve.mockClear();
    expect(await reconcilePending({ only: ids })).toMatchObject({ settled: 0, waiting: 0, failed: 0 });
    expect(sessionsRetrieve).not.toHaveBeenCalled();
    // an unpaid completion never confirms or refunds anything
    expect(made).toHaveLength(0);
    sessionsRetrieve.mockReset();
    sessionsRetrieve.mockImplementation(async (sessionId: string) => {
      if (retrieveFails) throw new Stripe.errors.StripeConnectionError({ message: "down" });
      return { id: sessionId, object: "checkout.session", status: "open", payment_status: "unpaid", payment_intent: null, ...sessionStates.get(sessionId) } as any;
    });
  });

  test("a payment that Stripe says is paid but whose hold lapsed follows the existing rules: refunded if the seats went", async () => {
    const type = await ticketType({ quota: 2 });
    const late = await order(type, "awaiting_payment", -1000);
    await order(type, "confirmed");
    const row = await payment(late, { status: "pending", createdAgoMs: 20 * MIN });
    retrieve(row, { status: "complete", payment_status: "paid", payment_intent: "pi_late" });

    expect(await reconcilePending({ only: [late] })).toMatchObject({ settled: 1 });
    expect((await paymentOf(row.id)).status).toBe("refunded");
    expect(made).toHaveLength(1);
    expect(await statusOf(late)).toBe("expired");
  });
});

describe("pending-payment polling failures", () => {
  const sessionWas = (row: { stripeSessionId: string }, session: Partial<Stripe.Checkout.Session>) => sessionStates.set(row.stripeSessionId, session);
  const due = (row: { id: string }) => db.update(payments).set({ recoveryNextAt: new Date(Date.now() - 1000) }).where(eq(payments.id, row.id));
  const failures = (error: Error) => {
    sessionsRetrieve.mockReset();
    sessionsRetrieve.mockImplementation(async () => {
      throw error;
    });
  };
  const restore = () => {
    sessionsRetrieve.mockReset();
    sessionsRetrieve.mockImplementation(async (id: string) => ({ id, object: "checkout.session", status: "open", payment_status: "unpaid", payment_intent: null, ...sessionStates.get(id) }) as any);
  };

  test("timeouts and rate limits are counted in the row with a growing backoff, held after MAX_POLL_ERRORS in a row; the buyer's check and a resume still work", async () => {
    const id = await order(await ticketType());
    const row = await payment(id, { status: "pending", createdAgoMs: 30 * MIN });
    try {
      for (let n = 1; n <= MAX_POLL_ERRORS; n++) {
        failures(n % 2 ? new Stripe.errors.StripeConnectionError({ message: "timeout" }) : new Stripe.errors.StripeRateLimitError({ message: "429" }));
        const before = Date.now();
        expect(await quiet(() => reconcilePending({ only: [id] }))).toMatchObject({ failed: 1, settled: 0 });
        const stored = await paymentOf(row.id);
        expect(stored.recoveryAttempts).toBe(n);
        expect(stored.recoveryNextAt!.getTime()).toBeGreaterThanOrEqual(before + backoffMs(n) - 1000);
        // not again before then, however often it runs (no tight loop)
        sessionsRetrieve.mockClear();
        expect(await reconcilePending({ only: [id] })).toMatchObject({ failed: 0, waiting: 0, settled: 0 });
        expect(sessionsRetrieve).not.toHaveBeenCalled();
        if (n < MAX_POLL_ERRORS) await due(row);
      }
      // held, and identifiable
      expect((await paymentOf(row.id)).recoveryHold).toBe("exhausted");
      await due(row);
      sessionsRetrieve.mockClear();
      expect(await reconcilePending({ only: [id] })).toMatchObject({ failed: 0, waiting: 0, settled: 0 });
      expect(sessionsRetrieve).not.toHaveBeenCalled();
      const held = await json(await request("GET", `/recovery/held?enrollmentId=${id}`, "admin"));
      expect(held.payments).toEqual([expect.objectContaining({ id: row.id, status: "pending", hold: "exhausted", attempts: MAX_POLL_ERRORS })]);
      expect(JSON.stringify(held)).not.toContain("cs_test");

      // the buyer's own check isn't blocked by it: Stripe is back, the payment is paid
      restore();
      sessionWas(row, { status: "complete", payment_status: "paid", payment_intent: "pi_after_outage" });
      expect(await json(await verify(id))).toEqual({ status: "confirmed" });
      const settled = await paymentOf(row.id);
      expect(settled).toMatchObject({ status: "paid", recoveryAttempts: 0, recoveryHold: null });
      expect(await statusOf(id)).toBe("confirmed");
    } finally {
      restore();
    }
  });

  test("a held pending payment is polled again once resumed, from a clean count", async () => {
    const id = await order(await ticketType());
    const row = await payment(id, { status: "pending", createdAgoMs: 30 * MIN });
    await db.update(payments).set({ recoveryHold: "exhausted", recoveryAttempts: MAX_POLL_ERRORS }).where(eq(payments.id, row.id));
    sessionWas(row, { status: "complete", payment_status: "paid", payment_intent: "pi_resumed" });
    expect(await reconcilePending({ only: [id] })).toMatchObject({ settled: 0 });
    expect(await json(await request("POST", `/recovery/payments/${row.id}/resume`, "admin"))).toEqual({ resumed: true });
    expect(await reconcilePending({ only: [id] })).toMatchObject({ settled: 1 });
    expect(await statusOf(id)).toBe("confirmed");
  });

  test("a session that is still open is not a failure: it resets the count and is asked again when it ends", async () => {
    const id = await order(await ticketType());
    const row = await payment(id, { status: "pending", createdAgoMs: 30 * MIN });
    await db.update(payments).set({ recoveryAttempts: 5 }).where(eq(payments.id, row.id));

    expect(await reconcilePending({ only: [id] })).toMatchObject({ waiting: 1, failed: 0 });
    const stored = await paymentOf(row.id);
    expect(stored.recoveryAttempts).toBe(0);
    expect(stored.recoveryHold).toBeNull();
    expect(stored.recoveryNextAt!.getTime()).toBeGreaterThan(Date.now() + 4 * MIN);
  });

  test("failed and expired sessions end through the existing transitions; a completed-but-unpaid one does nothing financial", async () => {
    const type = await ticketType();
    const unpaid = await order(type);
    const failed = await order(type);
    const unpaidRow = await payment(unpaid, { status: "pending", createdAgoMs: 30 * MIN });
    const failedRow = await payment(failed, { status: "pending", createdAgoMs: 30 * MIN });
    sessionWas(unpaidRow, { status: "complete", payment_status: "unpaid" });
    sessionWas(failedRow, { status: "expired", payment_status: "unpaid" });

    expect(await reconcilePending({ only: [unpaid, failed] })).toMatchObject({ settled: 1, waiting: 1, failed: 0 });
    expect((await paymentOf(failedRow.id)).status).toBe("expired");
    expect(await statusOf(failed)).toBe("expired");
    expect((await paymentOf(unpaidRow.id)).status).toBe("pending");
    expect(await statusOf(unpaid)).toBe("awaiting_payment");
    expect(made).toHaveLength(0);
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("replicas and the webhook asking at once: one settlement, the session is read once by the schedulers", async () => {
    const id = await order(await ticketType());
    const row = await payment(id, { status: "pending", createdAgoMs: 30 * MIN });
    sessionWas(row, { status: "complete", payment_status: "paid", payment_intent: "pi_race" });
    sessionsRetrieve.mockClear();

    const runs = await Promise.all([reconcilePending({ only: [id] }), reconcilePending({ only: [id] }), reconcilePending({ only: [id] })]);
    await webhook("checkout.session.completed", { id: row.stripeSessionId, payment_status: "paid", payment_intent: "pi_race" });

    expect(runs.reduce((n, r) => n + r.settled, 0)).toBe(1);
    expect(sessionsRetrieve).toHaveBeenCalledTimes(1);
    expect(mailsTo().filter((t) => t === "ticket")).toHaveLength(2);
    expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
  });

  test("a late payment over the ticket limit found by polling is held, never settled again by the schedulers, and a resume rechecks the limit instead of bypassing it", async () => {
    const type = await ticketType({ maxPerUser: 3 });
    const late = await order(type, "awaiting_payment", -1000);
    await order(type, "awaiting_payment");
    const row = await payment(late, { status: "pending", createdAgoMs: 30 * MIN });
    sessionWas(row, { status: "complete", payment_status: "paid", payment_intent: "pi_over" });

    expect(await quiet(() => reconcilePending({ only: [late] }))).toMatchObject({ settled: 1 });
    expect((await paymentOf(row.id)).recoveryHold).toBe("over_limit");
    sessionsRetrieve.mockClear();
    await due(row);
    for (let i = 0; i < 2; i++) {
      expect(await quiet(() => reconcilePending({ only: [late] }))).toMatchObject({ settled: 0 });
      expect(await quiet(() => reconcilePaid({ only: [late] }))).toMatchObject({ recovered: 0, review: 0, failed: 0 });
    }
    expect(sessionsRetrieve).not.toHaveBeenCalled();
    expect(made).toHaveLength(0);
    expect(await statusOf(late)).toBe("awaiting_payment");

    // resumed while still over the limit: it is looked at again and held again; nothing is confirmed or refunded
    expect(await resumePayment(row.id)).toBe(true);
    expect(await quiet(() => reconcilePaid({ only: [late] }))).toMatchObject({ review: 1, recovered: 0 });
    expect((await paymentOf(row.id)).recoveryHold).toBe("over_limit");
    expect(made).toHaveLength(0);
    expect(await statusOf(late)).toBe("awaiting_payment");
  });
});

describe("ticket mail outbox", () => {
  const outboxOf = (enrollmentId: string) =>
    db
      .select({ state: ticketMailOutbox.state, attempts: ticketMailOutbox.attempts, nextAttemptAt: ticketMailOutbox.nextAttemptAt })
      .from(ticketMailOutbox)
      .innerJoin(tickets, eq(tickets.id, ticketMailOutbox.ticketId))
      .where(eq(tickets.enrollmentId, enrollmentId));

  test("confirming records the mail in the same transaction; a mail queue that is down delays it, with backoff, and nothing is issued twice", async () => {
    const id = await order(await ticketType());
    await payment(id);
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });

    expect(await quiet(() => reconcilePaid({ only: [id] }))).toMatchObject({ recovered: 1 });
    // confirmed with its tickets, the mails owed and not yet sent
    expect(await statusOf(id)).toBe("confirmed");
    expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
    const owed = await outboxOf(id);
    expect(owed).toHaveLength(2);
    expect(owed.every((r) => r.state === "pending" && r.attempts === 1 && r.nextAttemptAt!.getTime() > Date.now())).toBe(true);

    // not before the backoff
    expect(await quiet(() => dispatchTicketMails({ enrollmentId: id }))).toEqual({ sent: 0, failed: 0, skipped: 0 });
    // the queue is back, the backoff has passed (a restarted worker: nothing is remembered but the rows)
    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    await db.update(ticketMailOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(outboxOfOrders(id));
    expect(await dispatchTicketMails({ enrollmentId: id })).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect((await outboxOf(id)).map((r) => r.state)).toEqual(["sent", "sent"]);
    expect(mailsTo().filter((t) => t === "ticket")).toHaveLength(2);

    // finishing the order again (a retry, a duplicate webhook, another replica) issues and sends nothing more
    await db.update(payments).set({ recoveryNextAt: new Date(Date.now() - 1000) }).where(eq(payments.enrollmentId, id));
    enqueueMail.mockClear();
    await reconcilePaid({ only: [id] });
    await dispatchTicketMails({ enrollmentId: id });
    expect(enqueueMail).not.toHaveBeenCalled();
    expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
    expect(await outboxOf(id)).toHaveLength(2);
  });

  test("the process died after confirming and before sending: any later run sends it, once each, even racing", async () => {
    const id = await order(await ticketType());
    await payment(id);
    // the crash: confirmed (with its outbox rows) and never dispatched
    const original = enqueueMail.getMockImplementation()!;
    enqueueMail.mockImplementation(async () => {
      throw new Error("died");
    });
    await quiet(() => reconcilePaid({ only: [id] }));
    await db.update(ticketMailOutbox).set({ nextAttemptAt: null, attempts: 0 }).where(outboxOfOrders(id));
    enqueueMail.mockReset();
    enqueueMail.mockImplementation(original);
    enqueueMail.mockClear();

    const reports = await Promise.all([dispatchTicketMails({ enrollmentId: id }), dispatchTicketMails({ enrollmentId: id }), dispatchTicketMails({ enrollmentId: id })]);
    expect(reports.reduce((n, r) => n + r.sent, 0)).toBeGreaterThanOrEqual(2);
    expect(mailsTo().filter((t) => t === "ticket")).toHaveLength(2);
    expect(new Set(enqueueMail.mock.calls.map(([m]) => (m as any).props.code)).size).toBe(2);
  });

  test("a mail that keeps failing is marked failed after its attempts; one whose order is no longer confirmed is skipped, not sent", async () => {
    const type = await ticketType();
    const failing = await order(type);
    const cancelled = await order(type);
    await payment(failing);
    await payment(cancelled);
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
    await quiet(() => reconcilePaid({ only: [failing, cancelled] }));
    // the second order is refunded and cancelled before its mail goes out
    await db.update(enrollments).set({ status: "cancelled" }).where(eq(enrollments.id, cancelled));

    for (let attempt = 2; attempt <= 8; attempt++) {
      await db.update(ticketMailOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(outboxOfOrders(failing));
      await quiet(() => dispatchTicketMails({ enrollmentId: failing }));
    }
    expect((await outboxOf(failing)).every((r) => r.state === "failed")).toBe(true);
    // failed rows are left alone
    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    await db.update(ticketMailOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(outboxOfOrders(failing, cancelled));
    expect(await dispatchTicketMails({ enrollmentId: failing })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await dispatchTicketMails({ enrollmentId: cancelled })).toEqual({ sent: 0, failed: 0, skipped: 2 });
    expect(enqueueMail).not.toHaveBeenCalled();
    expect((await outboxOf(cancelled)).map((r) => r.state)).toEqual(["skipped", "skipped"]);
  });

  test("an order that was never confirmed owes no mail", async () => {
    const id = await order(await ticketType());
    expect(await outboxOf(id)).toEqual([]);
    expect(await dispatchTicketMails({ enrollmentId: id })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    const held = await ticketType({ maxPerUser: 3 });
    const late = await order(held, "awaiting_payment", -1000);
    await order(held, "awaiting_payment");
    await payment(late);
    await quiet(() => reconcilePaid({ only: [late] }));
    expect(await outboxOf(late)).toEqual([]);
  });
});

describe("review findings", () => {
  test("a refund intent that is still being made is not an inconsistency: the reconciler leaves its payment alone", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    await db.insert(refunds).values({ enrollmentId: id, paymentId: row.id, amount: "300.00", percent: 50, status: "pending", initiatedBy: "buyer", recoveryNextAt: new Date(Date.now() + MIN) });

    expect(await reconcilePaid({ only: [id] })).toMatchObject({ ambiguous: 0, recovered: 0, failed: 0 });
    expect((await paymentOf(row.id)).recoveryHold).toBeNull();
  });

  test("the accepted payment run again (a lost acknowledgement, a stale list) is done, never refunded as a duplicate of its own earlier sibling", async () => {
    const id = await order(await ticketType());
    const early = await payment(id, { paidAgoMs: 40 * MIN, intent: "pi_early" });
    const accepted = await payment(id, { paidAgoMs: 20 * MIN, intent: "pi_accepted" });
    // the earlier one was claimed first but the later one got to confirm the order
    await db.update(enrollments).set({ status: "confirmed", expiresAt: null, acceptedPaymentId: accepted.id }).where(eq(enrollments.id, id));
    // the accepted payment's own settlement running once more
    await db.update(payments).set({ recoveryNextAt: new Date(Date.now() - 1000) }).where(eq(payments.id, accepted.id));
    const { recoverPayment } = await import("../src/libs/settle");
    expect(await recoverPayment(accepted.id)).toBe("done");
    expect((await paymentOf(accepted.id)).status).toBe("paid");
    expect(made).toHaveLength(0);
    // the other one is the duplicate
    expect(await reconcilePaid({ only: [id] })).toMatchObject({ recovered: 1 });
    expect(made.map((r) => r.payment_intent)).toEqual(["pi_early"]);
    expect((await paymentOf(early.id)).status).toBe("refunded");
  });

  test("a refund backing off or held says to try later, not that the order is already refunded", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    await db.insert(refunds).values({ enrollmentId: id, paymentId: row.id, amount: "300.00", percent: 50, status: "pending", initiatedBy: "buyer", recoveryAttempts: 2, recoveryNextAt: new Date(Date.now() + 30 * MIN) });

    const answer = await buyerRefund(id);
    expect(answer.status).toBe(503);
    expect((await json(answer)).code).toBe("REFUND_UNAVAILABLE");
    expect(made).toHaveLength(0);
    expect(await statusOf(id)).toBe("confirmed");
  });

  test("a payment with no charge to read is not taken for a bank transfer: nothing is recorded as refunded by hand", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    chargesList.mockImplementationOnce(async () => ({ data: [] }));

    expect((await quiet(() => buyerRefund(id))).status).toBe(503);
    expect((await paymentOf(row.id)).status).toBe("paid");
    expect((await refundsOf(id))[0]).toMatchObject({ status: "pending", stripeRefundId: null });
    expect(await statusOf(id)).toBe("confirmed");
    // asked again with the charge there, it is refunded through Stripe
    expect((await buyerRefund(id)).status).toBe(200);
    expect(made).toHaveLength(1);
  });

  test("ticket mails that gave up are listed for admins and can be sent again once what stopped them is fixed", async () => {
    const id = await order(await ticketType());
    await payment(id);
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue credentials expired");
    });
    await quiet(() => reconcilePaid({ only: [id] }));
    await db.update(ticketMailOutbox).set({ state: "failed", attempts: 8, nextAttemptAt: null }).where(outboxOfOrders(id));

    const held = await json(await request("GET", `/recovery/held?enrollmentId=${id}`, "admin"));
    expect(held.mails).toHaveLength(2);
    expect((await request("POST", `/recovery/mails/resume?enrollmentId=${id}`, "buyer")).status).toBe(403);
    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    const resumed = await json(await request("POST", `/recovery/mails/resume?enrollmentId=${id}`, "admin"));
    expect(resumed.resumed).toBe(2);
    expect(await dispatchTicketMails({ enrollmentId: id })).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(mailsTo().filter((t) => t === "ticket")).toHaveLength(2);
  });
});

describe("refund and cancellation mail", () => {
  const notificationsOf = (enrollmentId: string) => db.select().from(notificationOutbox).where(eq(notificationOutbox.enrollmentId, enrollmentId)).orderBy(asc(notificationOutbox.dedupeKey));
  const dueNow = (enrollmentId: string) => db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationOutbox.enrollmentId, enrollmentId));
  const queueDown = () =>
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
  const queueUp = () => enqueueMail.mockImplementation(async () => {});

  async function acceptedOrder() {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    return { id, row };
  }

  test("a buyer's refund committed with the queue down (or a crash right after the commit): mails wait in the outbox, are sent once later, and the refund isn't made again", async () => {
    const { id, row } = await acceptedOrder();
    queueDown();

    const answer = await quiet(() => buyerRefund(id));
    expect(answer.status).toBe(200);
    // the business change stands, and what is owed is recorded with it: the buyer, and the guest on the order
    expect(await statusOf(id)).toBe("cancelled");
    expect((await paymentOf(row.id)).status).toBe("refunded");
    const owed = await notificationsOf(id);
    expect(owed.map((n) => n.kind).sort()).toEqual(["order-cancelled", "ticket-cancelled"]);
    expect(owed.every((n) => n.state === "pending" && n.attempts === 1)).toBe(true);
    const [refund] = await refundsOf(id);
    expect(owed.find((n) => n.kind === "order-cancelled")!.dedupeKey).toBe(`order-cancelled:${refund!.id}`);

    // restart: nothing but the rows remain; the queue is back and the backoff has passed
    queueUp();
    enqueueMail.mockClear();
    await dueNow(id);
    const reports = await Promise.all([dispatchNotifications({ enrollmentId: id }), dispatchNotifications({ enrollmentId: id }), dispatchNotifications({ enrollmentId: id })]);
    expect(reports.reduce((n, r) => n + r.sent, 0)).toBeGreaterThanOrEqual(2);
    expect(mailsTo().sort()).toEqual(["order-cancelled", "ticket-cancelled"]);
    expect(enqueueMail.mock.calls.map(([m]) => m.to).sort()).toEqual([emailOf("buyer"), emailOf("guest")].sort());
    expect((await notificationsOf(id)).map((n) => n.state)).toEqual(["sent", "sent"]);
    // and nothing more, nor a second refund
    enqueueMail.mockClear();
    await dueNow(id);
    expect(await dispatchNotifications({ enrollmentId: id })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(enqueueMail).not.toHaveBeenCalled();
    expect(made).toHaveLength(1);
    expect(await refundsOf(id)).toHaveLength(1);
  });

  test("the queue accepts a message and the acknowledgement is lost: it is sent again (at least once), and no refund or ticket is repeated", async () => {
    const { id } = await acceptedOrder();
    const accepted: string[] = [];
    enqueueMail.mockImplementation(async (message) => {
      accepted.push(`${message.template}:${message.to}`);
      throw new Error("acknowledgement lost");
    });
    await quiet(() => buyerRefund(id));
    expect(accepted).toHaveLength(2);

    queueUp();
    await dueNow(id);
    // the second delivery of what the queue already has
    enqueueMail.mockImplementation(async (message) => void accepted.push(`${message.template}:${message.to}`));
    await dispatchNotifications({ enrollmentId: id });
    expect(accepted).toHaveLength(4);
    expect(new Set(accepted).size).toBe(2);
    expect(made).toHaveLength(1);
    expect(await refundsOf(id)).toHaveLength(1);
    expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
  });

  test("a system refund's mail (duplicate) is recorded with the refund and recovered after a restart; a refusal for good records no mail at all", async () => {
    const { id, second } = await orderWithDuplicate(await ticketType());
    behaviours.push("invalid");
    await quiet(() => reconcilePaid({ only: [id] }));
    // nothing was refunded, nothing is announced
    expect(await notificationsOf(id)).toEqual([]);
    expect(enqueueMail).not.toHaveBeenCalled();

    queueDown();
    await db.update(payments).set({ recoveryNextAt: new Date(Date.now() - 1000), recoveryHold: null, recoveryAttempts: 0 }).where(eq(payments.id, second.id));
    await quiet(() => reconcilePaid({ only: [id] }));
    expect((await paymentOf(second.id)).status).toBe("refunded");
    const [owed] = await notificationsOf(id);
    expect(owed).toMatchObject({ kind: "refund-system", state: "pending" });
    expect((await refundsOf(id)).map((r) => `refund-system:${r.id}`)).toEqual([owed!.dedupeKey]);

    queueUp();
    enqueueMail.mockClear();
    await dueNow(id);
    expect(await dispatchNotifications({ enrollmentId: id })).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ to: emailOf("buyer"), template: "refund-system", props: { reason: "duplicate" } });
  });

  test("a refund that failed later is recorded with its mail; the same event again adds nothing", async () => {
    const { id, row } = await acceptedOrder();
    expect((await buyerRefund(id)).status).toBe(200);
    const [refund] = await refundsOf(id);
    queueDown();
    enqueueMail.mockClear();
    const failed = () => webhook("refund.failed", { id: refund!.stripeRefundId, object: "refund", status: "failed", failure_reason: "expired_or_canceled_card", metadata: { paymentId: row.id } });
    await quiet(failed);
    await quiet(failed);
    const owed = (await notificationsOf(id)).filter((n) => n.kind === "refund-failed");
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ state: "pending", dedupeKey: `refund-failed:${refund!.id}` });

    queueUp();
    enqueueMail.mockClear();
    await dueNow(id);
    await dispatchNotifications({ enrollmentId: id });
    expect(mailsTo().filter((t) => t === "refund-failed")).toHaveLength(1);
  });

  test("notifications that keep failing end as failed, are listed for admins, and can be resumed", async () => {
    const { id } = await acceptedOrder();
    queueDown();
    await quiet(() => buyerRefund(id));
    for (let attempt = 2; attempt <= 8; attempt++) {
      await dueNow(id);
      await quiet(() => dispatchNotifications({ enrollmentId: id }));
    }
    expect((await notificationsOf(id)).every((n) => n.state === "failed")).toBe(true);
    const held = await json(await request("GET", `/recovery/held?enrollmentId=${id}`, "admin"));
    expect(held.notifications).toHaveLength(2);
    expect(JSON.stringify(held.notifications)).not.toContain("@");

    queueUp();
    enqueueMail.mockClear();
    expect((await json(await request("POST", `/recovery/mails/resume?enrollmentId=${id}`, "admin"))).resumed).toBe(2);
    await dispatchNotifications({ enrollmentId: id });
    expect(mailsTo().sort()).toEqual(["order-cancelled", "ticket-cancelled"]);
  });
});

describe("mixed versions: work an older payment service left half done", () => {
  /** What the previous version did before dying: made the refund at Stripe (no idempotency key, no intent row), recorded nothing. */
  const orphanRefund = (intent: string, paymentId: string, amount: number) => {
    const refund = { id: `re_old_${crypto.randomUUID().slice(0, 8)}`, status: "succeeded", payment_intent: intent, amount, metadata: { paymentId } } as unknown as Stripe.Refund;
    listed.push(refund);
    made.push(refund);
    return refund;
  };

  test("a buyer's refund the old version made at Stripe and never recorded is recorded by the new one, not made again", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN, intent: "pi_old_buyer" });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    const orphan = orphanRefund("pi_old_buyer", row.id, 30_000);

    expect((await buyerRefund(id)).status).toBe(200);

    expect(refundsCreate).not.toHaveBeenCalled();
    expect(made).toHaveLength(1);
    expect((await refundsOf(id))[0]).toMatchObject({ stripeRefundId: orphan.id, status: "succeeded" });
    expect((await paymentOf(row.id)).status).toBe("refunded");
    expect(await statusOf(id)).toBe("cancelled");
  });

  test("a system refund the old version made and never recorded (a payment stranded as paid) is recorded by the scheduler, not made again", async () => {
    const type = await ticketType({ quota: 2 });
    const late = await order(type, "awaiting_payment", -1000);
    await order(type, "confirmed");
    const row = await payment(late, { intent: "pi_old_system" });
    const orphan = orphanRefund("pi_old_system", row.id, 60_000);

    expect(await reconcilePaid({ only: [late] })).toMatchObject({ recovered: 1 });

    expect(refundsCreate).not.toHaveBeenCalled();
    expect((await refundsOf(late))[0]).toMatchObject({ stripeRefundId: orphan.id, initiatedBy: "system", note: "unavailable" });
    expect((await paymentOf(row.id)).status).toBe("refunded");
    expect(await statusOf(late)).toBe("expired");
  });

  test("an order the old version confirmed (no accepted payment, no outbox rows, mail sent inline) is still handled: a later payment is the duplicate, nothing is mailed twice", async () => {
    const id = await order(await ticketType(), "confirmed");
    const first = await payment(id, { paidAgoMs: 40 * MIN });
    const second = await payment(id, { paidAgoMs: 20 * MIN });
    expect(await db.$count(ticketMailOutbox, sql`${ticketMailOutbox.ticketId} in (select id from tickets where enrollment_id = ${id})`)).toBe(0);

    expect(await reconcilePaid({ only: [id] })).toMatchObject({ recovered: 1 });
    expect((await paymentOf(first.id)).status).toBe("paid");
    expect((await paymentOf(second.id)).status).toBe("refunded");
    expect(mailsTo().filter((t) => t === "ticket")).toHaveLength(0);
  });
});

describe("shutdown", () => {
  test("a SIGTERM stops an idle service cleanly and quickly (draining in-flight requests is Elysia's stop(), read in its source, not exercised here; a pass in progress is asked to halt, tested below)", async () => {
    const child = Bun.spawn(["bun", "--env-file=../../.env", "src/index.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, NODE_ENV: "development", PORT: "39211" },
      stdout: "pipe",
      stderr: "pipe",
    });
    // up: answers its health check
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      up = await fetch("http://localhost:39211/api/payment/health").then((r) => r.ok, () => false);
      if (!up) await Bun.sleep(100);
    }
    expect(up).toBe(true);
    const started = Date.now();
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("review findings, phase 3", () => {
  test("a shutdown asks the pass in progress to stop after the record it is on", async () => {
    const type = await ticketType();
    const ids = [await order(type), await order(type), await order(type)];
    for (const id of ids) await payment(id);
    let asked = 0;
    // stop after the first record
    const report = await reconcilePaid({ only: ids, halt: () => asked++ >= 1 });
    expect(report.recovered).toBe(1);
    expect((await Promise.all(ids.map(statusOf))).filter((st) => st === "confirmed")).toHaveLength(1);
    // the rest is there for the next process
    expect(await reconcilePaid({ only: ids })).toMatchObject({ recovered: 2 });
  });

  test("a settlement that fails (not the lookup) while polling is counted and backed off too, and the payment stays pending, not lost", async () => {
    const type = await ticketType({ quota: 2 });
    const late = await order(type, "awaiting_payment", -1000);
    await order(type, "confirmed");
    const row = await payment(late, { status: "pending", createdAgoMs: 30 * MIN });
    sessionStates.set(row.stripeSessionId, { status: "complete", payment_status: "paid", payment_intent: "pi_settle_fail" });
    // Stripe refuses the refund the late payment needs: settling throws, and releases the payment
    behaviours.push("invalid");

    expect(await quiet(() => reconcilePending({ only: [late] }))).toMatchObject({ failed: 1, settled: 0 });
    const stored = await paymentOf(row.id);
    expect(stored.status).toBe("pending");
    expect(stored.recoveryAttempts).toBe(1);
    expect(stored.recoveryNextAt!.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 5000);
    // straight away again: backed off, no second call
    sessionsRetrieve.mockClear();
    expect(await reconcilePending({ only: [late] })).toMatchObject({ failed: 0, settled: 0, waiting: 0 });
    expect(sessionsRetrieve).not.toHaveBeenCalled();
    // once due, the refund goes through
    await db.update(payments).set({ recoveryNextAt: new Date(Date.now() - 1000) }).where(eq(payments.id, row.id));
    expect(await reconcilePending({ only: [late] })).toMatchObject({ settled: 1 });
    expect((await paymentOf(row.id)).status).toBe("refunded");
  });

  test("a held pending payment whose session then ends is no longer listed as held", async () => {
    const id = await order(await ticketType());
    const row = await payment(id, { status: "pending", createdAgoMs: 30 * MIN });
    await db.update(payments).set({ recoveryHold: "exhausted", recoveryAttempts: 8 }).where(eq(payments.id, row.id));
    await webhook("checkout.session.expired", { id: row.stripeSessionId });
    expect(await paymentOf(row.id)).toMatchObject({ status: "expired", recoveryHold: null, recoveryAttempts: 0 });
    expect((await heldRecords({ enrollmentId: id })).payments).toEqual([]);
  });

  test("a refund notice is not sent once its refund has failed: the buyer gets the failure notice only", async () => {
    const { id, row } = await (async () => {
      const oid = await order(await ticketType(), "confirmed");
      const p = await payment(oid, { paidAgoMs: 40 * MIN });
      await db.update(enrollments).set({ acceptedPaymentId: p.id }).where(eq(enrollments.id, oid));
      return { id: oid, row: p };
    })();
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
    await quiet(() => buyerRefund(id));
    const [refund] = await refundsOf(id);
    await quiet(() => webhook("refund.failed", { id: refund!.stripeRefundId, object: "refund", status: "failed", failure_reason: "lost_or_stolen_card", metadata: { paymentId: row.id } }));
    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    await db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationOutbox.enrollmentId, id));
    const report = await dispatchNotifications({ enrollmentId: id });
    // the failure notice and the guest's ticket notice go; "your refund is on its way" is skipped
    expect(mailsTo().sort()).toEqual(["refund-failed", "ticket-cancelled"]);
    expect(report.skipped).toBe(1);
  });
});

describe("cancelled refunds and the operator's view of the outboxes", () => {
  const notificationsOf = (enrollmentId: string) => db.select().from(notificationOutbox).where(eq(notificationOutbox.enrollmentId, enrollmentId)).orderBy(asc(notificationOutbox.dedupeKey));

  /** A cancelled order whose refund Stripe has not finished: pending, with its Stripe id. */
  async function pendingRefund(status: "pending" | "succeeded" = "pending") {
    const id = await order(await ticketType(), "cancelled");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(payments).set({ status: "refunded" }).where(eq(payments.id, row.id));
    const [refund] = await db
      .insert(refunds)
      .values({ enrollmentId: id, paymentId: row.id, amount: "300.00", percent: 50, status, initiatedBy: "buyer", stripeRefundId: `re_cancel_${crypto.randomUUID().slice(0, 8)}` })
      .returning();
    return { id, row, refund: refund! };
  }
  const refundEvent = (refund: { stripeRefundId: string | null }, row: { id: string }, status: string, type = "refund.updated") =>
    webhook(type, { id: refund.stripeRefundId, object: "refund", status, metadata: { paymentId: row.id } });

  test("a refund Stripe cancelled is recorded as cancelled with its provider id, the buyer is told once (not that it is refunded), and the payment's state is not rewritten", async () => {
    const { id, row, refund } = await pendingRefund();
    expect((await refundEvent(refund, row, "canceled")).status).toBe(200);

    const [stored] = await refundsOf(id);
    expect(stored).toMatchObject({ status: "canceled", stripeRefundId: refund.stripeRefundId });
    // the payment was marked refunded when the intent was recorded; a cancelled refund does not claim more or less than that
    expect((await paymentOf(row.id)).status).toBe("refunded");
    expect(await statusOf(id)).toBe("cancelled");
    const owed = await notificationsOf(id);
    expect(owed.map((n) => n.kind)).toEqual(["refund-canceled"]);
    expect(owed[0]).toMatchObject({ state: "sent", dedupeKey: `refund-canceled:${stored!.id}`, refundId: stored!.id });
    expect(mailsTo()).toEqual(["refund-canceled"]);
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ to: emailOf("buyer"), props: { amount: 300 } });

    // the event again, and older news arriving late: nothing changes, nobody is mailed again
    enqueueMail.mockClear();
    await refundEvent(refund, row, "canceled");
    await refundEvent(refund, row, "pending");
    await refundEvent(refund, row, "succeeded", "refund.updated");
    await refundEvent(refund, row, "failed", "refund.failed");
    expect((await refundsOf(id))[0]!.status).toBe("canceled");
    expect(await notificationsOf(id)).toHaveLength(1);
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("the notice survives a queue that is down, and a duplicate worker; a refund that had succeeded is not turned into a cancellation by a stale event", async () => {
    const { id, row, refund } = await pendingRefund();
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
    await quiet(() => refundEvent(refund, row, "canceled"));
    expect((await notificationsOf(id))[0]).toMatchObject({ kind: "refund-canceled", state: "pending", attempts: 1, lastError: "Error" });

    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    await db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationOutbox.enrollmentId, id));
    const reports = await Promise.all([dispatchNotifications({ enrollmentId: id }), dispatchNotifications({ enrollmentId: id })]);
    expect(reports.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(mailsTo()).toEqual(["refund-canceled"]);

    // a refund that succeeded stays succeeded: no cancellation, no notice
    const done = await pendingRefund("succeeded");
    enqueueMail.mockClear();
    await refundEvent(done.refund, done.row, "canceled");
    expect((await refundsOf(done.id))[0]!.status).toBe("succeeded");
    expect(await notificationsOf(done.id)).toEqual([]);
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("a cancellation notice whose refund is no longer cancelled is skipped, not sent", async () => {
    const { id, row, refund } = await pendingRefund();
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
    await quiet(() => refundEvent(refund, row, "canceled"));
    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    // the operator put the refund back in progress by hand
    await db.update(refunds).set({ status: "pending" }).where(eq(refunds.enrollmentId, id));
    await db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationOutbox.enrollmentId, id));
    expect(await dispatchNotifications({ enrollmentId: id })).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("the outbox overview tells pending, leased, retry scheduled, failed, sent and skipped apart, without a message or a recipient", async () => {
    const { id, refund } = await pendingRefund();
    const future = new Date(Date.now() + 5 * MIN);
    const base = { enrollmentId: id, refundId: refund.id, message: { to: "secret-recipient@example.com", template: "order-cancelled", props: { name: "Secret Name" } } };
    const row = (key: string, extra: Record<string, unknown>) => ({ ...base, dedupeKey: `${key}:${refund.id}`, kind: "order-cancelled", ...extra });
    await db.insert(notificationOutbox).values([
      row("a-pending", {}),
      row("b-leased", { attempts: 1, nextAttemptAt: future, lastAttemptAt: new Date(), lastError: null }),
      row("c-retry", { attempts: 2, nextAttemptAt: future, lastAttemptAt: new Date(), lastError: "TimeoutError" }),
      row("d-failed", { state: "failed", attempts: 8, lastError: "TimeoutError" }),
      row("e-sent", { state: "sent", attempts: 1, sentAt: new Date() }),
      row("f-skipped", { state: "skipped", attempts: 1 }),
    ] as never);

    expect((await request("GET", `/recovery/outbox?enrollmentId=${id}`, "buyer")).status).toBe(403);
    expect((await request("GET", `/recovery/outbox?enrollmentId=${id}`, "nobody")).status).toBe(401);
    expect((await request("GET", "/recovery/outbox?enrollmentId=not-a-uuid", "admin")).status).toBe(422);
    const view = await json(await request("GET", `/recovery/outbox?enrollmentId=${id}`, "admin"));

    expect(view.notifications.counts).toEqual({ pending: 1, leased: 1, retry_scheduled: 1, failed: 1, sent: 1, skipped: 1 });
    expect(view.notifications.open.map((r: any) => [r.kind, r.status]).sort()).toEqual([
      ["order-cancelled", "failed"], ["order-cancelled", "leased"], ["order-cancelled", "pending"], ["order-cancelled", "retry_scheduled"],
    ].sort());
    const retry = view.notifications.open.find((r: any) => r.status === "retry_scheduled");
    expect(retry).toMatchObject({ attempts: 2, lastError: "TimeoutError" });
    expect(new Date(retry.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    const text = JSON.stringify(view);
    for (const secret of ["secret-recipient", "Secret Name", "message", "props", "@"]) expect(text).not.toContain(secret);
    expect(view.ticketMails.counts).toMatchObject({ pending: 0, failed: 0 });
  });

  test("resuming failed mail does not bypass what they announce: a stale one is skipped when it is tried again", async () => {
    const { id, refund } = await pendingRefund();
    const [failed] = await db
      .insert(notificationOutbox)
      .values({ dedupeKey: `refund-system:${refund.id}`, kind: "refund-system", enrollmentId: id, refundId: refund.id, message: { to: emailOf("buyer"), template: "refund-system", props: {} }, state: "failed", attempts: 8, lastError: "TimeoutError" })
      .returning();
    // the refund then failed for real: "your refund is on its way" is no longer true
    await db.update(refunds).set({ status: "failed" }).where(eq(refunds.id, refund.id));
    expect((await request("POST", `/recovery/mails/resume?enrollmentId=${id}`, "buyer")).status).toBe(403);
    expect((await json(await request("POST", `/recovery/mails/resume?enrollmentId=${id}`, "admin"))).resumed).toBe(1);
    enqueueMail.mockClear();
    expect(await dispatchNotifications({ enrollmentId: id })).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect((await notificationsOf(id)).find((n) => n.id === failed!.id)!.state).toBe("skipped");
    expect(enqueueMail).not.toHaveBeenCalled();
  });
});

describe("shutdown with work in flight (a real process, the real scheduler and shutdown handler)", () => {
  const dir = new URL("..", import.meta.url).pathname;
  const childPath = new URL("./shutdown.child.ts", import.meta.url).pathname;

  /** A service process that is serving, with its scheduler running over `ids`; `release` lets its slow request finish. */
  async function startChild(ids: string[], env: Record<string, string> = {}) {
    // a port nobody holds right now
    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = probe.port;
    probe.stop(true);
    const releaseFile = `${tmpdir()}/payment-shutdown-${crypto.randomUUID()}`;
    const proc = Bun.spawn(["bun", "--env-file=../../.env", childPath, ...ids], {
      cwd: dir,
      env: { ...process.env, PORT: String(port), RELEASE_FILE: releaseFile, MAIL_QUEUE_URL: "http://127.0.0.1:9/none", SQS_ENDPOINT: "http://127.0.0.1:9", AWS_ACCESS_KEY_ID: "x", AWS_SECRET_ACCESS_KEY: "x", AWS_REGION: "us-east-1", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      if (await fetch(`${base}/ping`).then((r) => r.ok, () => false)) break;
      await Bun.sleep(100);
    }
    const state = () => fetch(`${base}/state`).then((r) => r.json() as Promise<{ inFlight: number; completed: number }>);
    const release = () => Bun.write(releaseFile, "go");
    const cleanup = async () => {
      const { unlink } = await import("node:fs/promises");
      await unlink(releaseFile).catch(() => {});
      // a test that failed half way must not leave a scheduler running
      if (proc.exitCode === null) proc.kill("SIGKILL");
    };
    children.push(cleanup);
    return { proc, base, state, release, cleanup, stderr: () => new Response(proc.stderr).text() };
  }
  const children: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of children.splice(0)) await cleanup();
  });
  const until = async (check: () => Promise<boolean>, ms = 8000) => {
    for (let waited = 0; waited < ms; waited += 50) {
      if (await check()) return true;
      await Bun.sleep(50);
    }
    return false;
  };

  test("SIGTERM with a request in flight: the scheduler stops, new requests are refused, the request finishes, the process exits 0 within the grace period; what the scheduler hadn't done is recovered by the next process", async () => {
    const type = await ticketType();
    const [first, second] = [await order(type), await order(type)];
    await payment(first);
    const child = await startChild([first, second]);
    let slow: Promise<Response> = Promise.reject(new Error("not started"));
    void slow.catch(() => {});
    try {
      // the scheduler is alive: it finishes the first stranded payment by itself
      expect(await until(async () => (await statusOf(first)) === "confirmed")).toBe(true);

      // a request begins and stays in progress
      slow = fetch(`${child.base}/slow`);
      expect(await until(async () => (await child.state()).inFlight === 1)).toBe(true);

      child.proc.kill("SIGTERM");
      // another stranded payment appears after the signal: the scheduler must not start it
      await payment(second);
      await Bun.sleep(1200);
      expect(await statusOf(second)).toBe("awaiting_payment");
      // the server takes no new request while it drains
      const refused = await fetch(`${child.base}/ping`).then((r) => r.status, () => "refused");
      expect(refused).not.toBe(200);
      // and the process is still up: the request is in flight
      expect(child.proc.exitCode).toBeNull();
    } finally {
      await child.release();
    }
    // the request that was in flight when the signal came was answered, not cut off
    expect((await slow).status).toBe(200);
    // (the slow request was started above; collect it now that it may finish)
    const exitCode = await child.proc.exited;
    await child.cleanup();
    expect(exitCode).toBe(0);
    // no unhandled error or failed shutdown; the only thing it logs is the ticket mail it couldn't send to the unreachable queue
    const logged = await child.stderr();
    expect(logged).not.toMatch(/Unhandled|Shutdown failed|TypeError|ReferenceError/);

    // nothing was started after the signal, and the next instance finishes what was left, once
    expect(await statusOf(second)).toBe("awaiting_payment");
    expect(await reconcilePaid({ only: [second] })).toMatchObject({ recovered: 1 });
    expect(await statusOf(second)).toBe("confirmed");
    expect(await db.$count(tickets, eq(tickets.enrollmentId, second))).toBe(2);
  }, 30_000);

  test("the request in flight completes and its answer reaches the client, and only then does the process exit", async () => {
    const child = await startChild([]);
    const slow = fetch(`${child.base}/slow`).then(async (r) => ({ status: r.status, body: await r.text() }));
    expect(await until(async () => (await child.state()).inFlight === 1)).toBe(true);
    child.proc.kill("SIGTERM");
    await Bun.sleep(500);
    expect(child.proc.exitCode).toBeNull();
    await child.release();
    expect(await slow).toEqual({ status: 200, body: "done" });
    expect(await child.proc.exited).toBe(0);
    await child.cleanup();
    expect(await child.stderr()).toBe("");
  }, 30_000);

  test("a second signal ends the process at once, request or not (exit 1)", async () => {
    const child = await startChild([]);
    void fetch(`${child.base}/slow`).catch(() => {});
    expect(await until(async () => (await child.state()).inFlight === 1)).toBe(true);
    child.proc.kill("SIGTERM");
    await Bun.sleep(300);
    expect(child.proc.exitCode).toBeNull();
    const second = Date.now();
    child.proc.kill("SIGTERM");
    expect(await child.proc.exited).toBe(1);
    expect(Date.now() - second).toBeLessThan(2000);
    await child.cleanup();
  }, 30_000);

  test("a mail queue that never answers can't hold the shutdown past the queue's own timeout: the pass ends, the process exits 0, and the mail stays owed for the next process", async () => {
    const silent = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    try {
      const id = await order(await ticketType());
      const child = await startChild([id], { SQS_ENDPOINT: `http://127.0.0.1:${silent.port}`, MAIL_QUEUE_URL: `http://127.0.0.1:${silent.port}/000000000000/mail-queue` });
      await payment(id);
      // confirmed: the scheduler is now sending the ticket mail into the silent queue
      expect(await until(async () => (await statusOf(id)) === "confirmed")).toBe(true);
      const signalled = Date.now();
      child.proc.kill("SIGTERM");
      const code = await child.proc.exited;
      const took = Date.now() - signalled;
      await child.cleanup();
      expect(code).toBe(0);
      // bounded by the 10 s send timeout (plus the rest of the record), nowhere near the 150 s grace period
      expect(took).toBeLessThan(20_000);
      // the mail is owed, not lost: pending in the outbox, sent by whoever runs next
      const owed = await db
        .select()
        .from(ticketMailOutbox)
        .where(inArray(ticketMailOutbox.ticketId, db.select({ id: tickets.id }).from(tickets).where(eq(tickets.enrollmentId, id))));
      expect(owed).toHaveLength(2);
      // each was tried (the pass sent them into the silent queue) and ended by the timeout, not skipped or left untouched
      expect(owed.every((r) => r.state === "pending" && r.attempts >= 1 && r.lastError === "AbortError")).toBe(true);
      expect(took).toBeGreaterThanOrEqual(8_000);
      await db.update(ticketMailOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(outboxOfOrders(id));
      enqueueMail.mockClear();
      expect(await dispatchTicketMails({ enrollmentId: id })).toEqual({ sent: 2, failed: 0, skipped: 0 });
      expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
    } finally {
      silent.stop(true);
    }
  }, 60_000);
});

describe("preflight (read-only check before a rollout or rollback)", () => {
  test("an unresolved refund intent blocks it, and it prints counts only", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.insert(refunds).values({ enrollmentId: id, paymentId: row.id, amount: "300.00", percent: 50, status: "pending", initiatedBy: "buyer" });
    const proc = Bun.spawn(["bun", "--env-file=../../.env", "scripts/preflight.ts"], { cwd: new URL("..", import.meta.url).pathname, env: process.env, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout as ReadableStream).text();
    expect(await proc.exited).toBe(1);
    expect(out).toMatch(/refund intents unresolved\s+[1-9]\d*\s+BLOCKS/);
    expect(out).toContain("payments_paid_at_check validated");
    expect(out).not.toContain("@");
    expect(out).not.toContain("pi_");
  }, 30_000);

  test("a held payment blocks a rollback (an older version ignores holds) but not an upgrade, and mail still owed blocks only a rollback", async () => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    await db.update(payments).set({ recoveryHold: "over_limit" }).where(eq(payments.id, row.id));
    const run = async (mode: string) => {
      const proc = Bun.spawn(["bun", "--env-file=../../.env", "scripts/preflight.ts", "--mode", mode], { cwd: new URL("..", import.meta.url).pathname, env: process.env, stdout: "pipe", stderr: "pipe" });
      const out = await new Response(proc.stdout as ReadableStream).text();
      await proc.exited;
      const line = out.split("\n").find((l) => l.startsWith("PREFLIGHT_RESULT "))!;
      return JSON.parse(line.slice("PREFLIGHT_RESULT ".length)) as { ok: boolean; blocking: string[] };
    };
    expect((await run("rollback")).blocking).toContain("records_held_that_an_older_version_ignores");
    expect((await run("upgrade")).blocking).not.toContain("records_held_that_an_older_version_ignores");
  }, 30_000);
});

describe("review findings, phase 4", () => {
  const notificationsOf = (enrollmentId: string) => db.select().from(notificationOutbox).where(eq(notificationOutbox.enrollmentId, enrollmentId)).orderBy(asc(notificationOutbox.dedupeKey));

  test.each([["failed", "refund-failed"], ["canceled", "refund-canceled"]] as const)("a refund that Stripe reports as %s the moment it is made still tells the buyer (no later webhook will), and not that the order is refunded", async (status, kind) => {
    const id = await order(await ticketType(), "confirmed");
    const row = await payment(id, { paidAgoMs: 40 * MIN });
    await db.update(enrollments).set({ acceptedPaymentId: row.id }).where(eq(enrollments.id, id));
    nextRefundStatus = status;

    expect((await buyerRefund(id)).status).toBe(200);
    expect((await refundsOf(id))[0]!.status).toBe(status);
    // the buyer hears the refund did not go through; the guest still hears their ticket is cancelled; "your order is refunded" is not said
    expect(mailsTo().sort()).toEqual([kind, "ticket-cancelled"]);
    const owed = await notificationsOf(id);
    expect(owed.find((n) => n.kind === "order-cancelled")!.state).toBe("skipped");
  });

  test("the overview's counts and open rows stay right when there are far more than a thousand finished mails", async () => {
    const id = await order(await ticketType(), "confirmed");
    const base = { enrollmentId: id, kind: "order-cancelled", message: { to: "x@example.com" }, state: "sent" };
    const rows = Array.from({ length: 1100 }, (_, i) => ({ ...base, dedupeKey: `bulk-sent:${id}:${i}` }));
    for (let i = 0; i < rows.length; i += 500) await db.insert(notificationOutbox).values(rows.slice(i, i + 500) as never);
    await db.insert(notificationOutbox).values([
      { ...base, dedupeKey: `bulk-pending:${id}`, state: "pending" },
      { ...base, dedupeKey: `bulk-failed:${id}`, state: "failed", attempts: 8, lastError: "AbortError" },
    ] as never);

    const view = await json(await request("GET", `/recovery/outbox?enrollmentId=${id}`, "admin"));
    expect(view.notifications.counts).toMatchObject({ sent: 1100, pending: 1, failed: 1 });
    expect(view.notifications.open.map((r: any) => r.status).sort()).toEqual(["failed", "pending"]);
  });
});

describe("two processes", () => {
  test("two real processes recovering the same payments at once confirm each order once", async () => {
    const type = await ticketType();
    const ids = [await order(type), await order(type), await order(type)];
    for (const id of ids) await payment(id);
    const child = new URL("./replica.child.ts", import.meta.url).pathname;
    const run = () =>
      Bun.spawn(["bun", "--env-file=../../.env", child, ...ids], {
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, MAIL_QUEUE_URL: "http://127.0.0.1:9/none", SQS_ENDPOINT: "http://127.0.0.1:9", AWS_ACCESS_KEY_ID: "x", AWS_SECRET_ACCESS_KEY: "x", AWS_REGION: "us-east-1" },
        stdout: "pipe",
        stderr: "ignore",
      });
    const children = [run(), run()];
    const reports = await Promise.all(children.map(async (c) => JSON.parse((await new Response(c.stdout).text()).trim().split("\n").pop()!)));

    expect(reports.reduce((n, r) => n + r.recovered, 0)).toBe(3);
    for (const id of ids) {
      expect(await statusOf(id)).toBe("confirmed");
      expect(await db.$count(tickets, eq(tickets.enrollmentId, id))).toBe(2);
      expect(await outboxOf(id)).toHaveLength(2);
      expect((await db.select().from(enrollments).where(eq(enrollments.id, id)))[0]!.acceptedPaymentId).not.toBeNull();
      expect((await db.select().from(payments).where(and(eq(payments.enrollmentId, id), isNull(payments.recoveryHold)))).map((p) => p.recoveryAttempts)).toEqual([1]);
    }

    function outboxOf(id: string) {
      return db.select().from(ticketMailOutbox).innerJoin(tickets, eq(tickets.id, ticketMailOutbox.ticketId)).where(eq(tickets.enrollmentId, id));
    }
  });
});
