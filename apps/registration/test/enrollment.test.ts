import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AuthSession, Role } from "@app/auth-guard";
import type { MailMessage } from "@app/mail";

const enqueueMail = mock(async (_message: MailMessage) => {});
mock.module("@app/mail", () => ({ enqueueMail }));

// Stand in for the auth service: the cookie header is the name of a seeded user.
const sessions = new Map<string, AuthSession>();
const resolve = async (headers: Headers) => sessions.get(headers.get("cookie") ?? "") ?? null;
const actual = { ...(await import("@app/auth-guard")) };
mock.module("@app/auth-guard", () => ({
  ...actual,
  authGuard: actual.createAuthGuard(resolve, "test"),
  authenticate: actual.createAuthenticator(resolve),
}));

const { registration: app } = await import("../src/app");
const {
  db, enrollments, eq, eventCategories, eventInvitations, events, inArray, notificationOutbox, ticketTypeQuestions, ticketTypes, users,
} = await import("@app/db");
const { dispatchNotifications } = await import("@app/tickets");

const runId = crypto.randomUUID().slice(0, 8);
const userIds: Record<string, string> = {};
const eventIds: string[] = [];
let categoryId: string;

const emailOf = (name: string) => `${name}-${runId}@example.com`;

async function seedUser(name: string, role: Role) {
  const [user] = await db
    .insert(users)
    .values({ name, email: emailOf(name), role })
    .returning({ id: users.id, email: users.email });
  userIds[name] = user!.id;
  sessions.set(name, {
    user: { id: user!.id, name, email: user!.email, image: null, role },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
  });
}

const json = (response: Response): Promise<any> => response.json();

function request(method: string, path: string, as?: string, body?: unknown) {
  const headers: Record<string, string> = as ? { cookie: as } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.handle(
    new Request(`http://localhost/api/regis${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

type EventOptions = { status?: "draft" | "public" | "invite"; ended?: boolean };

async function createEvent({ status = "public", ended = false }: EventOptions = {}) {
  const now = Date.now();
  const [event] = await db
    .insert(events)
    .values({
      organizerId: userIds.owner!,
      categoryId,
      title: "Workshop",
      slug: `workshop-${crypto.randomUUID().slice(0, 12)}`,
      venue: "Hall",
      status,
      startsAt: new Date(ended ? now - 2 * 86_400_000 : now + 86_400_000),
      endsAt: new Date(ended ? now - 86_400_000 : now + 2 * 86_400_000),
    })
    .returning({ id: events.id });
  eventIds.push(event!.id);
  return event!.id;
}

type TypeOptions = {
  kind?: "first_come" | "approval" | "invite";
  price?: number;
  quota?: number | null;
  maxPerUser?: number;
  questions?: { type: "short_text" | "long_text" | "choice"; label: string; required: boolean; options?: string[] }[];
};

async function createType(eventId: string, { kind = "first_come", price = 0, quota, maxPerUser = 5, questions = [] }: TypeOptions = {}) {
  const [type] = await db
    .insert(ticketTypes)
    .values({
      eventId,
      kind,
      name: `${kind} ticket`,
      price: price.toFixed(2),
      quota: kind === "first_come" ? (quota ?? 10) : null,
      maxPerUser,
    })
    .returning({ id: ticketTypes.id });
  const inserted = questions.length
    ? await db
        .insert(ticketTypeQuestions)
        .values(questions.map((q, position) => ({ ...q, options: q.options ?? null, ticketTypeId: type!.id, position })))
        .returning({ id: ticketTypeQuestions.id })
    : [];
  return { id: type!.id, questionIds: inserted.map((q) => q.id) };
}

const attendee = (name: string, answers: { questionId: string; value: string }[] = []) => ({
  firstName: name,
  lastName: "Tester",
  email: emailOf(name).toUpperCase(),
  answers,
});

const enroll = (ticketTypeId: string, attendees = [attendee("buyer")], as = "buyer") =>
  request("POST", "/enrollments", as, { ticketTypeId, attendees });

const availabilityOf = async (eventId: string, ticketTypeId: string, as?: string) =>
  (await json(await request("GET", `/events/${eventId}/availability`, as))).find((a: any) => a.ticketTypeId === ticketTypeId);

const mailedTo = () => enqueueMail.mock.calls.map(([message]) => message.to).sort();

beforeAll(async () => {
  for (const name of ["owner", "other"]) await seedUser(name, "organizer");
  await seedUser("admin", "admin");
  for (const name of ["buyer", "friend", "stranger"]) await seedUser(name, "user");
  const [category] = await db
    .insert(eventCategories)
    .values({ name: `cat-reg-${runId}`, slug: `cat-reg-${runId}` })
    .returning({ id: eventCategories.id });
  categoryId = category!.id;
});

beforeEach(() => {
  enqueueMail.mockReset();
  enqueueMail.mockImplementation(async () => {});
});

afterAll(async () => {
  await db.delete(enrollments).where(inArray(enrollments.eventId, eventIds));
  await db.delete(events).where(inArray(events.id, eventIds));
  await db.delete(eventCategories).where(eq(eventCategories.id, categoryId));
  await db.delete(users).where(inArray(users.id, Object.values(userIds)));
});

describe("first come, first served", () => {
  test("a free one is confirmed and mailed to every attendee; tickets show for the buyer and for the attendee's account", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId);
    const response = await enroll(type.id, [attendee("buyer"), attendee("friend")]);
    expect(response.status).toBe(200);
    const enrollment = await json(response);
    expect(enrollment).toMatchObject({ status: "confirmed", quantity: 2, total: 0, buyer: { id: userIds.buyer } });
    // in the order they were entered; emails are stored lowercase; codes are there once confirmed
    expect(enrollment.tickets.map((t: any) => t.email)).toEqual([emailOf("buyer"), emailOf("friend")]);
    expect(enrollment.tickets.every((t: any) => /^[0-9A-Z]{10}$/.test(t.code))).toBeTrue();
    expect(mailedTo()).toEqual([emailOf("buyer"), emailOf("friend")]);

    const mine = await json(await request("GET", "/tickets/mine", "friend"));
    const friendTicket = mine.tickets.find((t: any) => t.enrollmentId === enrollment.id);
    expect(friendTicket).toMatchObject({ email: emailOf("friend"), isBuyer: false, boughtBy: { name: "buyer" } });
    expect((await request("GET", `/tickets/${friendTicket.id}`, "friend")).status).toBe(200);
    expect((await request("GET", `/tickets/${friendTicket.id}`, "buyer")).status).toBe(200);
    expect((await request("GET", `/tickets/${friendTicket.id}`, "stranger")).status).toBe(404);

    // the buyer sees both tickets of their order
    const buyerTickets = (await json(await request("GET", "/tickets/mine", "buyer"))).tickets.filter(
      (t: any) => t.enrollmentId === enrollment.id,
    );
    expect(buyerTickets).toHaveLength(2);
    expect(buyerTickets.every((t: any) => t.isBuyer && t.boughtBy === null)).toBeTrue();
  });

  test("concurrent enrollments never take more seats than the quota", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { quota: 3, maxPerUser: 10 });
    const responses = await Promise.all(Array.from({ length: 6 }, () => enroll(type.id)));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 409, 409, 409]);
    expect(await availabilityOf(eventId, type.id, "buyer")).toMatchObject({ confirmed: 3, remaining: 0, state: "sold_out" });
  });

  test("the max per account holds across orders", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { maxPerUser: 2 });
    expect((await enroll(type.id)).status).toBe(200);
    const tooMany = await enroll(type.id, [attendee("buyer"), attendee("friend")]);
    expect((await json(tooMany)).code).toBe("LIMIT_REACHED");
    expect((await enroll(type.id)).status).toBe(200);
    expect((await json(await enroll(type.id))).code).toBe("LIMIT_REACHED");
    expect(await availabilityOf(eventId, type.id, "buyer")).toMatchObject({ mine: 2, state: "limit_reached" });
    expect(await availabilityOf(eventId, type.id, "friend")).toMatchObject({ mine: 0, state: "open" });
  });

  test("a paid one holds its seats until the hold lapses, and mails nothing yet", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { price: 300, quota: 2 });
    const enrollment = await json(await enroll(type.id, [attendee("buyer"), attendee("friend")]));
    expect(enrollment).toMatchObject({ status: "awaiting_payment", unitPrice: 300, total: 600 });
    expect(enrollment.expiresAt).not.toBeNull();
    expect(enrollment.tickets.every((t: any) => t.code === null)).toBeTrue();
    expect(enqueueMail).not.toHaveBeenCalled();
    expect(await availabilityOf(eventId, type.id)).toMatchObject({ reserved: 2, remaining: 0, state: "sold_out" });
    expect((await json(await request("GET", "/tickets/mine", "buyer"))).orders.map((o: any) => o.id)).toContain(enrollment.id);

    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, enrollment.id));
    expect(await availabilityOf(eventId, type.id)).toMatchObject({ reserved: 0, remaining: 2, state: "open" });
    expect((await json(await request("GET", `/enrollments/${enrollment.id}`, "buyer"))).status).toBe("expired");
  });

  test("an order keeps the refund policy it was made with; a cancelled one frees its seats", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { price: 300, quota: 2 });
    expect((await json(await enroll(type.id))).refundTerms).toBeNull();

    await db.update(events).set({ isRefundAvailable: true, refundCutoffHours: 24, refundPercent: 50 }).where(eq(events.id, eventId));
    const enrollment = await json(await enroll(type.id));
    const deadline = new Date(Date.parse(enrollment.event.startsAt) - 24 * 3_600_000).toISOString();
    expect(enrollment).toMatchObject({ refundTerms: { percent: 50, amount: 150, deadline }, refunds: [], cancelledAt: null });

    // the organizer changes the policy afterwards
    await db.update(events).set({ isRefundAvailable: false, refundCutoffHours: null, refundPercent: null }).where(eq(events.id, eventId));
    expect((await json(await request("GET", `/enrollments/${enrollment.id}`, "buyer"))).refundTerms).toMatchObject({ percent: 50 });

    // as apps/payment cancels it on a refund
    await db.update(enrollments).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(enrollments.id, enrollment.id));
    expect((await json(await request("GET", `/enrollments/${enrollment.id}`, "buyer"))).status).toBe("cancelled");
    expect(await availabilityOf(eventId, type.id)).toMatchObject({ reserved: 1, remaining: 1 });
    expect((await json(await request("GET", `/events/${eventId}/enrollments`, "owner"))).counts).toMatchObject({ cancelled: 1 });
  });
});

describe("invite only", () => {
  test("needs an invitation for the buyer's email, which one enrollment uses up", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { kind: "invite", maxPerUser: 3 });
    expect(await availabilityOf(eventId, type.id)).toMatchObject({ state: "invite_only" });
    expect((await json(await enroll(type.id))).code).toBe("NOT_INVITED");

    const [invitation] = await db
      .insert(eventInvitations)
      .values({ eventId, email: emailOf("buyer") })
      .returning({ id: eventInvitations.id });
    const response = await enroll(type.id, [attendee("buyer"), attendee("friend")]);
    expect((await json(response)).status).toBe("confirmed");
    const [used] = await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation!.id));
    expect(used!.usedAt).not.toBeNull();
    expect((await json(await enroll(type.id))).code).toBe("INVITATION_USED");
    expect(await availabilityOf(eventId, type.id, "buyer")).toMatchObject({ state: "invitation_used" });
  });

  test("an invite-only event is hidden from people who aren't invited", async () => {
    const eventId = await createEvent({ status: "invite" });
    const type = await createType(eventId);
    expect((await json(await enroll(type.id))).code).toBe("INVITE_ONLY");
    expect((await request("GET", `/events/${eventId}/availability`, "buyer")).status).toBe(403);
    await db.insert(eventInvitations).values({ eventId, email: emailOf("buyer") });
    expect((await json(await enroll(type.id))).status).toBe("confirmed");
  });
});

describe("approval", () => {
  test("waits for the organizer; approving a free one confirms and mails it", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { kind: "approval" });
    const enrollment = await json(await enroll(type.id));
    expect(enrollment.status).toBe("pending");
    expect(await availabilityOf(eventId, type.id)).toMatchObject({ pending: 1, remaining: null });

    expect((await request("POST", `/enrollments/${enrollment.id}/approve`, "other")).status).toBe(403);
    expect((await request("POST", `/enrollments/${enrollment.id}/approve`, "buyer")).status).toBe(403);
    const approved = await json(await request("POST", `/enrollments/${enrollment.id}/approve`, "owner"));
    expect(approved).toMatchObject({ status: "confirmed" });
    expect(approved.reviewedAt).not.toBeNull();
    expect(mailedTo()).toEqual([emailOf("buyer")]);
    expect((await json(await request("POST", `/enrollments/${enrollment.id}/approve`, "owner"))).code).toBe(
      "ENROLLMENT_NOT_PENDING",
    );
  });

  test("approving a paid one asks for payment; rejecting tells the buyer why", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { kind: "approval", price: 500 });
    const first = await json(await enroll(type.id));
    const approved = await json(await request("POST", `/enrollments/${first.id}/approve`, "admin"));
    expect(approved.status).toBe("awaiting_payment");
    expect(new Date(approved.expiresAt).getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({
      to: emailOf("buyer"),
      template: "enrollment-approved",
      props: { payBy: approved.expiresAt, url: expect.stringContaining(`/tickets/orders/${first.id}`) },
    });

    enqueueMail.mockClear();
    const second = await json(await enroll(type.id));
    const rejected = await json(
      await request("POST", `/enrollments/${second.id}/reject`, "owner", { note: "เต็มแล้ว <b>" }),
    );
    expect(rejected.status).toBe("rejected");
    // raw: the template escapes it
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ template: "enrollment-rejected", props: { reason: "เต็มแล้ว <b>" } });
  });

  test("the decision mail is recorded with the decision: a queue that is down, or a crash after the commit, only delays it; it is sent once, and not when it has gone stale", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { kind: "approval", price: 500 });
    const outboxOf = (id: string) => db.select().from(notificationOutbox).where(eq(notificationOutbox.enrollmentId, id));

    // approving a paid one with the queue down: the decision stands, the mail waits (the process "died" before sending it)
    const first = await json(await enroll(type.id));
    enqueueMail.mockClear();
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
    const approvedWhileDown = await request("POST", `/enrollments/${first.id}/approve`, "owner");
    expect((await json(approvedWhileDown)).status).toBe("awaiting_payment");
    const [owed] = await outboxOf(first.id);
    expect(owed).toMatchObject({ kind: "enrollment-approved", state: "pending", dedupeKey: `enrollment-approved:${first.id}` });
    expect(owed!.attempts).toBe(1);
    expect(owed!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // later (a restarted worker, the backoff passed) and with the queue back: sent once
    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    await db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationOutbox.enrollmentId, first.id));
    expect(await dispatchNotifications({ enrollmentId: first.id })).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await dispatchNotifications({ enrollmentId: first.id })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(enqueueMail).toHaveBeenCalledTimes(1);
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ to: emailOf("buyer"), template: "enrollment-approved", props: { payBy: expect.any(String) } });

    // a rejection with the queue down, sent later with its reason
    const second = await json(await enroll(type.id));
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
    expect((await json(await request("POST", `/enrollments/${second.id}/reject`, "owner", { note: "full" }))).status).toBe("rejected");
    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    await db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationOutbox.enrollmentId, second.id));
    expect(await dispatchNotifications({ enrollmentId: second.id })).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ template: "enrollment-rejected", props: { reason: "full" } });

    // an approval that is stale by the time it would be sent (the hold lapsed meanwhile) is skipped, not sent
    const third = await json(await enroll(type.id));
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
    await request("POST", `/enrollments/${third.id}/approve`, "owner");
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, third.id));
    enqueueMail.mockImplementation(async () => {});
    enqueueMail.mockClear();
    await db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationOutbox.enrollmentId, third.id));
    expect(await dispatchNotifications({ enrollmentId: third.id })).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(enqueueMail).not.toHaveBeenCalled();

    // a decision that is refused leaves no mail behind (nothing rolled back is announced)
    const before = (await outboxOf(first.id)).length;
    expect((await request("POST", `/enrollments/${first.id}/approve`, "owner")).status).toBe(409);
    expect((await request("POST", `/enrollments/${first.id}/reject`, "owner", {})).status).toBe(409);
    expect((await outboxOf(first.id)).length).toBe(before);
  });

  test("only a pending enrollment can be approved or rejected, and only once", async () => {
    const eventId = await createEvent();
    const free = await createType(eventId, { kind: "approval", maxPerUser: 10 });
    const paid = await createType(eventId, { kind: "approval", price: 500, maxPerUser: 10 });
    const decide = async (id: string, action: "approve" | "reject", as = "owner") => {
      const response = await request("POST", `/enrollments/${id}/${action}`, as, action === "reject" ? {} : undefined);
      return response.status === 200 ? "ok" : (await json(response)).code;
    };

    // rejected: can't be approved or rejected again
    const rejected = await json(await enroll(free.id));
    expect(await decide(rejected.id, "reject")).toBe("ok");
    expect(await decide(rejected.id, "approve")).toBe("ENROLLMENT_NOT_PENDING");
    expect(await decide(rejected.id, "reject")).toBe("ENROLLMENT_NOT_PENDING");

    // approved and confirmed: can't be rejected
    const confirmed = await json(await enroll(free.id));
    expect(await decide(confirmed.id, "approve")).toBe("ok");
    expect(await decide(confirmed.id, "reject")).toBe("ENROLLMENT_NOT_PENDING");

    // approved and waiting for payment: can't be rejected or approved again, even once the window lapsed
    const waiting = await json(await enroll(paid.id));
    expect(await decide(waiting.id, "approve")).toBe("ok");
    expect(await decide(waiting.id, "reject")).toBe("ENROLLMENT_NOT_PENDING");
    expect(await decide(waiting.id, "approve")).toBe("ENROLLMENT_NOT_PENDING");
    await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, waiting.id));
    expect((await json(await request("GET", `/enrollments/${waiting.id}`, "buyer"))).status).toBe("expired");
    expect(await decide(waiting.id, "approve")).toBe("ENROLLMENT_NOT_PENDING");
    expect(await decide(waiting.id, "reject")).toBe("ENROLLMENT_NOT_PENDING");

    // cancelled (refunded): closed for good
    const cancelled = await json(await enroll(free.id));
    await db.update(enrollments).set({ status: "cancelled" }).where(eq(enrollments.id, cancelled.id));
    expect(await decide(cancelled.id, "approve")).toBe("ENROLLMENT_NOT_PENDING");

    expect(await decide(crypto.randomUUID(), "approve")).toBe("ENROLLMENT_NOT_FOUND");
    for (const action of ["approve", "reject"] as const) {
      const response = await request("POST", `/enrollments/${rejected.id}/${action}`, undefined, action === "reject" ? {} : undefined);
      expect(response.status).toBe(401);
    }
  });

  test("two approvals at once approve once and mail once", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { kind: "approval" });
    const enrollment = await json(await enroll(type.id));
    enqueueMail.mockClear();
    const [a, b] = await Promise.all([
      request("POST", `/enrollments/${enrollment.id}/approve`, "owner"),
      request("POST", `/enrollments/${enrollment.id}/approve`, "admin"),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await json(a.status === 409 ? a : b)).code).toBe("ENROLLMENT_NOT_PENDING");
    expect(mailedTo()).toEqual([emailOf("buyer")]);

    // approving and rejecting at once: one wins, never both
    const second = await json(await enroll(type.id));
    const [approve, reject] = await Promise.all([
      request("POST", `/enrollments/${second.id}/approve`, "owner"),
      request("POST", `/enrollments/${second.id}/reject`, "owner", {}),
    ]);
    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
  });

  test("the organizer lists enrollments with counts per status, and finds attendees by email", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, { kind: "approval", maxPerUser: 10 });
    const a = await json(await enroll(type.id, [attendee("friend")]));
    await enroll(type.id);
    await request("POST", `/enrollments/${a.id}/approve`, "owner");

    const list = await json(await request("GET", `/events/${eventId}/enrollments?status=pending`, "owner"));
    expect(list.total).toBe(1);
    expect(list.counts).toMatchObject({ pending: 1, confirmed: 1 });
    const found = await json(await request("GET", `/events/${eventId}/enrollments?q=${emailOf("friend")}`, "owner"));
    expect(found.items.map((e: any) => e.id)).toEqual([a.id]);
    expect((await request("GET", `/events/${eventId}/enrollments`, "other")).status).toBe(403);
    expect((await request("GET", `/enrollments/${a.id}`, "owner")).status).toBe(200);
    expect((await request("GET", `/enrollments/${a.id}`, "stranger")).status).toBe(404);
  });
});

describe("answers and gates", () => {
  test("answers are checked against the questions and copied with their labels", async () => {
    const eventId = await createEvent();
    const type = await createType(eventId, {
      questions: [
        { type: "short_text", label: "Company", required: true },
        { type: "choice", label: "Size", required: false, options: ["S", "M"] },
      ],
    });
    const [company, size] = type.questionIds;
    const missing = await enroll(type.id, [attendee("buyer", [{ questionId: size!, value: "S" }])]);
    expect((await json(missing)).code).toBe("INVALID_ANSWERS");
    const badChoice = await enroll(type.id, [
      attendee("buyer", [{ questionId: company!, value: "Acme" }, { questionId: size!, value: "XL" }]),
    ]);
    expect((await json(badChoice)).code).toBe("INVALID_ANSWERS");
    const unknown = await enroll(type.id, [
      attendee("buyer", [{ questionId: company!, value: "Acme" }, { questionId: crypto.randomUUID(), value: "x" }]),
    ]);
    expect((await json(unknown)).code).toBe("INVALID_ANSWERS");

    const ok = await json(await enroll(type.id, [attendee("buyer", [{ questionId: company!, value: "  Acme " }])]));
    expect(ok.tickets[0].answers).toEqual([{ questionId: company, label: "Company", value: "Acme" }]);
  });

  test("drafts and ended events are closed", async () => {
    const draft = await createEvent({ status: "draft" });
    const draftType = await createType(draft);
    expect((await json(await enroll(draftType.id))).code).toBe("EVENT_NOT_FOUND");
    // the organizer previews it
    expect(await availabilityOf(draft, draftType.id, "owner")).toMatchObject({ state: "closed" });

    const ended = await createEvent({ ended: true });
    const endedType = await createType(ended);
    expect((await json(await enroll(endedType.id))).code).toBe("ENROLLMENT_NOT_OPEN");
    expect(await availabilityOf(ended, endedType.id)).toMatchObject({ state: "closed" });
    expect((await request("POST", "/enrollments", undefined, { ticketTypeId: endedType.id, attendees: [attendee("x")] })).status).toBe(401);
  });
});
