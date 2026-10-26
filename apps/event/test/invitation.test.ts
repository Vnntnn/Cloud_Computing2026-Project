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

const { event: app } = await import("../src/app");
const { db, dispatchNotifications, eq, eventCategories, eventInvitations, events, inArray, notificationOutbox, sql, users } = await import("@app/db");

const runId = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];
const eventIds: string[] = [];
let categoryId: string;

const emailOf = (name: string) => `${name}-${runId}@example.com`;

async function seedUser(name: string, role: Role) {
  const [user] = await db
    .insert(users)
    .values({ name, email: emailOf(name), role })
    .returning({ id: users.id, email: users.email });
  userIds.push(user!.id);
  sessions.set(name, {
    user: { id: user!.id, name, email: user!.email, image: null, role },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return user!.id;
}

/** A session for someone whose account is created only after they were invited. */
function signInAs(name: string, userId: string) {
  sessions.set(name, {
    user: { id: userId, name, email: emailOf(name), image: null, role: "user" },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
  });
}

const json = (response: Response): Promise<any> => response.json();

function request(method: string, path: string, as?: string, body?: unknown) {
  const headers: Record<string, string> = as ? { cookie: as } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.handle(
    new Request(`http://localhost/api/events${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function createEvent(as = "owner", status = "invite") {
  const response = await request("POST", "/", as, {
    title: "Private party",
    categoryId,
    venue: "Hall",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  });
  const body = await json(response);
  eventIds.push(body.id);
  await request("PATCH", `/${body.id}`, as, { status });
  return body as { id: string; slug: string };
}

const invite = async (eventId: string, emails: string[], as = "owner") =>
  request("POST", `/${eventId}/invitations`, as, { emails });

beforeAll(async () => {
  await seedUser("owner", "organizer");
  await seedUser("other", "organizer");
  await seedUser("admin", "admin");
  await seedUser("guest", "user");
  await seedUser("stranger", "user");
  const [category] = await db
    .insert(eventCategories)
    .values({ name: `cat-inv-${runId}`, slug: `cat-inv-${runId}` })
    .returning({ id: eventCategories.id });
  categoryId = category!.id;
});

beforeEach(() => {
  enqueueMail.mockReset();
  enqueueMail.mockImplementation(async () => {});
});

afterAll(async () => {
  // the outbox rows of these events' invitations (they point at the invitation by id, not by a foreign key)
  await db
    .delete(notificationOutbox)
    .where(inArray(notificationOutbox.subjectId, db.select({ id: eventInvitations.id }).from(eventInvitations).where(inArray(eventInvitations.eventId, eventIds))));
  // and any made for an event this file didn't register: every address it invites carries its run id
  await db.delete(notificationOutbox).where(sql`${notificationOutbox.dedupeKey} like ${`event-invitation:%${runId}@example.com:%`}`);
  await db.delete(events).where(inArray(events.id, eventIds));
  await db.delete(eventCategories).where(eq(eventCategories.id, categoryId));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("create", () => {
  test("invites accounts and not-yet-registered emails; shows the account when there is one", async () => {
    const event = await createEvent();
    const response = await invite(event.id, [emailOf("guest").toUpperCase(), `nobody-${runId}@example.com`]);
    expect(response.status).toBe(200);
    const { invited, skipped } = await json(response);
    expect(skipped).toEqual([]);
    const byEmail = Object.fromEntries(invited.map((i: any) => [i.email, i]));
    // stored lowercase, matched to the account
    expect(byEmail[emailOf("guest")].user).toMatchObject({ name: "guest", id: userIds[3] });
    expect(byEmail[emailOf("guest")].user).not.toHaveProperty("email");
    expect(byEmail[`nobody-${runId}@example.com`].user).toBeNull();
    expect(invited.every((i: any) => i.status === "unused" && i.usedAt === null)).toBeTrue();
  });

  test("skips emails already invited, and duplicates within one request", async () => {
    const event = await createEvent();
    await invite(event.id, [emailOf("guest")]);
    const { invited, skipped } = await json(
      await invite(event.id, [emailOf("guest"), `new-${runId}@example.com`, `NEW-${runId}@example.com`]),
    );
    expect(invited.map((i: any) => i.email)).toEqual([`new-${runId}@example.com`]);
    expect(skipped).toEqual([emailOf("guest")]);
  });

  test("rejects invalid emails and anyone but the owner or an admin", async () => {
    const event = await createEvent();
    expect((await invite(event.id, ["not-an-email"])).status).toBe(422);
    expect((await invite(event.id, [])).status).toBe(422);
    expect((await invite(event.id, [emailOf("guest")], "other")).status).toBe(403);
    expect((await invite(event.id, [emailOf("guest")], "guest")).status).toBe(403);
    expect((await request("POST", `/${event.id}/invitations`, undefined, { emails: [emailOf("guest")] })).status).toBe(401);
    expect((await invite(event.id, [emailOf("guest")], "admin")).status).toBe(200);
  });
});

describe("list", () => {
  test("filters by status and search, with counts for every status", async () => {
    const event = await createEvent();
    await invite(event.id, [emailOf("guest"), `a-${runId}@example.com`, `b-${runId}@example.com`]);
    await db
      .update(eventInvitations)
      .set({ usedAt: new Date() })
      .where(eq(eventInvitations.email, `a-${runId}@example.com`));

    const all = await json(await request("GET", `/${event.id}/invitations`, "owner"));
    expect(all.total).toBe(3);
    expect(all.counts).toEqual({ used: 1, unused: 2 });

    const used = await json(await request("GET", `/${event.id}/invitations?status=used`, "owner"));
    expect(used.items.map((i: any) => i.email)).toEqual([`a-${runId}@example.com`]);
    expect(used.items[0].status).toBe("used");
    expect(used.total).toBe(1);

    // search matches the account name too
    const byName = await json(await request("GET", `/${event.id}/invitations?q=guest`, "owner"));
    expect(byName.items.map((i: any) => i.email)).toEqual([emailOf("guest")]);

    expect((await request("GET", `/${event.id}/invitations`, "other")).status).toBe(403);
  });
});

describe("update and delete", () => {
  test("fixes the email of an unused invitation; refuses a duplicate", async () => {
    const event = await createEvent();
    const { invited } = await json(await invite(event.id, [`typo-${runId}@example.com`, emailOf("stranger")]));
    const typo = invited.find((i: any) => i.email.startsWith("typo"));

    const fixed = await json(
      await request("PATCH", `/${event.id}/invitations/${typo.id}`, "owner", { email: emailOf("guest") }),
    );
    expect(fixed.email).toBe(emailOf("guest"));
    expect(fixed.user.name).toBe("guest");

    const duplicate = await request("PATCH", `/${event.id}/invitations/${typo.id}`, "owner", {
      email: emailOf("stranger"),
    });
    expect(duplicate.status).toBe(409);
    expect((await json(duplicate)).code).toBe("INVITATION_EXISTS");
  });

  test("a used invitation is locked; an unused one can be revoked", async () => {
    const event = await createEvent();
    const { invited } = await json(await invite(event.id, [`used-${runId}@example.com`, `unused-${runId}@example.com`]));
    const [used, unused] = [invited.find((i: any) => i.email.startsWith("used")), invited.find((i: any) => i.email.startsWith("unused"))];
    await db.update(eventInvitations).set({ usedAt: new Date() }).where(eq(eventInvitations.id, used.id));

    expect((await json(await request("DELETE", `/${event.id}/invitations/${used.id}`, "owner"))).code).toBe("INVITATION_USED");
    expect(
      (await json(await request("PATCH", `/${event.id}/invitations/${used.id}`, "owner", { email: `x-${runId}@example.com` }))).code,
    ).toBe("INVITATION_USED");
    expect((await request("DELETE", `/${event.id}/invitations/${unused.id}`, "owner")).status).toBe(200);
    expect((await request("DELETE", `/${event.id}/invitations/${unused.id}`, "owner")).status).toBe(404);
  });

  test("an invitation of another event is not found through this one", async () => {
    const mine = await createEvent();
    const theirs = await createEvent("other");
    const { invited } = await json(await invite(theirs.id, [emailOf("guest")], "other"));
    expect((await request("DELETE", `/${mine.id}/invitations/${invited[0].id}`, "owner")).status).toBe(404);
  });
});

const mailedTo = () => enqueueMail.mock.calls.map(([message]) => message.to).sort();

/** Switching to invite mails in the background; wait until `count` mails are queued. */
async function waitForMails(count: number) {
  for (let i = 0; i < 100 && enqueueMail.mock.calls.length < count; i++) await Bun.sleep(10);
}

describe("mail", () => {
  test("an invite-only event emails each new invitee once, by name when they have an account", async () => {
    const event = await createEvent();
    const { invited } = await json(await invite(event.id, [emailOf("guest"), `fresh-${runId}@example.com`]));
    expect(invited.every((i: any) => i.notifiedAt !== null)).toBeTrue();
    expect(mailedTo()).toEqual([emailOf("guest"), `fresh-${runId}@example.com`].sort());

    const byTo = Object.fromEntries(enqueueMail.mock.calls.map(([message]) => [message.to, message]));
    expect(byTo[emailOf("guest")]).toMatchObject({
      template: "event-invitation",
      props: { name: "guest", event: { title: "Private party" }, url: expect.stringMatching(new RegExp(`/events/${event.slug}$`)) },
    });
    // no account yet: the link signs them up first, then lands on the event
    expect(byTo[`fresh-${runId}@example.com`]).toMatchObject({
      props: { name: null, url: expect.stringContaining(`/register?redirect=${encodeURIComponent(`/events/${event.slug}`)}`) },
    });

    // inviting again (skipped) mails no one
    await invite(event.id, [emailOf("guest")]);
    expect(enqueueMail).toHaveBeenCalledTimes(2);
  });

  test("a draft's invitees are mailed once it switches to invite-only, and not again after", async () => {
    const event = await createEvent("owner", "draft");
    const { invited } = await json(await invite(event.id, [emailOf("guest"), emailOf("stranger")]));
    expect(invited.every((i: any) => i.notifiedAt === null)).toBeTrue();
    expect(enqueueMail).not.toHaveBeenCalled();

    await request("PATCH", `/${event.id}`, "owner", { status: "invite" });
    await waitForMails(2);
    expect(mailedTo()).toEqual([emailOf("guest"), emailOf("stranger")].sort());

    await request("PATCH", `/${event.id}`, "owner", { status: "draft" });
    await request("PATCH", `/${event.id}`, "owner", { status: "invite" });
    await Bun.sleep(50);
    expect(enqueueMail).toHaveBeenCalledTimes(2);
  });

  test("changing the email mails the new address", async () => {
    const event = await createEvent();
    const { invited } = await json(await invite(event.id, [`old-${runId}@example.com`]));
    enqueueMail.mockClear();
    const updated = await json(
      await request("PATCH", `/${event.id}/invitations/${invited[0].id}`, "owner", { email: `new-mail-${runId}@example.com` }),
    );
    expect(updated.notifiedAt).not.toBeNull();
    expect(mailedTo()).toEqual([`new-mail-${runId}@example.com`]);
  });

  // Changed with the outbox: a queue that is down used to release the claim (notified_at back to null) so that the *next invite call*
  // would retry; now the claim and the mail are recorded together, so the invitation is claimed and the mail is retried by the outbox
  // (see "invitation mail survives a crash"), without anyone having to invite again.
  test("a failed enqueue doesn't fail the invite; the mail is owed and retried by the outbox, not by the next invite", async () => {
    const event = await createEvent();
    enqueueMail.mockImplementationOnce(async () => {
      throw new Error("queue down");
    });
    const first = await invite(event.id, [`retry-${runId}@example.com`]);
    expect(first.status).toBe(200);
    expect((await json(first)).invited[0].notifiedAt).not.toBeNull();

    // the next invite mails only its own invitee: the first is the outbox's to retry
    await invite(event.id, [`later-${runId}@example.com`]);
    expect(mailedTo()).toEqual([`later-${runId}@example.com`, `retry-${runId}@example.com`].sort());
    const list = await json(await request("GET", `/${event.id}/invitations`, "owner"));
    expect(list.items.every((i: any) => i.notifiedAt !== null)).toBeTrue();
  });
});

describe("access", () => {
  test("an invited account opens the invite-only event; others are told it's invite-only", async () => {
    const event = await createEvent();
    await invite(event.id, [emailOf("guest")]);
    expect((await json(await request("GET", `/${event.slug}`, "guest"))).id).toBe(event.id);
    expect((await json(await request("GET", `/${event.slug}`, "stranger"))).code).toBe("INVITE_ONLY");
    expect((await json(await request("GET", `/${event.slug}`))).code).toBe("INVITE_ONLY");
  });

  test("someone invited before registering gets in once they sign up with that email", async () => {
    const event = await createEvent();
    await invite(event.id, [emailOf("latecomer")]);
    const listed = await json(await request("GET", `/${event.id}/invitations`, "owner"));
    expect(listed.items[0].user).toBeNull();

    const userId = await seedUser("latecomer", "user");
    signInAs("latecomer", userId);
    expect((await request("GET", `/${event.slug}`, "latecomer")).status).toBe(200);
    const after = await json(await request("GET", `/${event.id}/invitations`, "owner"));
    expect(after.items[0].user.id).toBe(userId);
  });

  test("invitations only open invite-only events, not drafts", async () => {
    const event = await createEvent("owner", "draft");
    await invite(event.id, [emailOf("guest")]);
    expect((await request("GET", `/${event.slug}`, "guest")).status).toBe(404);
  });

  test("a suspended event's invitations stay readable but frozen for its organizer", async () => {
    const event = await createEvent();
    await request("PATCH", `/${event.id}`, "admin", { status: "suspended" });
    expect((await request("GET", `/${event.id}/invitations`, "owner")).status).toBe(200);
    expect((await json(await invite(event.id, [emailOf("guest")]))).code).toBe("EVENT_SUSPENDED");
    expect((await request("GET", `/${event.slug}`, "guest")).status).toBe(404);
  });
});

describe("invitation mail survives a crash", () => {
  const outboxOf = (eventId: string) =>
    db
      .select({ outbox: notificationOutbox })
      .from(notificationOutbox)
      .innerJoin(eventInvitations, eq(eventInvitations.id, notificationOutbox.subjectId))
      .where(eq(eventInvitations.eventId, eventId))
      .then((rows) => rows.map((r) => r.outbox));
  const queueDown = () =>
    enqueueMail.mockImplementation(async () => {
      throw new Error("queue down");
    });
  const queueUp = () => enqueueMail.mockImplementation(async () => {});
  const dueNow = (eventId: string) =>
    db
      .update(notificationOutbox)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(inArray(notificationOutbox.subjectId, db.select({ id: eventInvitations.id }).from(eventInvitations).where(eq(eventInvitations.eventId, eventId))));
  const send = async (eventId: string) => {
    const ids = (await db.select({ id: eventInvitations.id }).from(eventInvitations).where(eq(eventInvitations.eventId, eventId))).map((r) => r.id);
    return dispatchNotifications((message) => enqueueMail(message), { subjectIds: ids });
  };

  test("an invitation committed with the queue down is claimed and its mail recorded together; it is sent once later, and the invitation isn't duplicated", async () => {
    const event = await createEvent();
    queueDown();
    const response = await invite(event.id, [emailOf("guest")]);
    expect(response.status).toBe(200);
    const [invited] = (await json(response)).invited;
    // the invitation stands, claimed, with its mail owed
    expect(invited.notifiedAt).not.toBeNull();
    const [owed] = await outboxOf(event.id);
    expect(owed).toMatchObject({ kind: "event-invitation", state: "pending", dedupeKey: expect.stringMatching(new RegExp(`^event-invitation:${invited.id}:${emailOf("guest")}:\\d+$`)) });
    expect(owed!.attempts).toBe(1);
    expect(owed!.lastError).toBe("Error");

    // the process restarts, the backoff passes, the queue is back
    queueUp();
    enqueueMail.mockClear();
    await dueNow(event.id);
    expect(await send(event.id)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await send(event.id)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(enqueueMail).toHaveBeenCalledTimes(1);
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ to: emailOf("guest"), template: "event-invitation", props: { email: emailOf("guest") } });
    expect(await db.$count(eventInvitations, eq(eventInvitations.eventId, event.id))).toBe(1);
  });

  test("a revoked, re-addressed or no-longer-invite-only invitation is not mailed when its time comes", async () => {
    const event = await createEvent();
    queueDown();
    const { invited } = await json(await invite(event.id, [emailOf("guest"), emailOf("stranger"), `third-${runId}@example.com`]));
    const byEmail = Object.fromEntries(invited.map((i: any) => [i.email, i]));
    expect((await outboxOf(event.id)).length).toBe(3);

    // revoked
    expect((await request("DELETE", `/${event.id}/invitations/${byEmail[emailOf("guest")].id}`, "owner")).status).toBeLessThan(300);
    // re-addressed: the new address gets its own mail, the old one's is stale
    queueUp();
    enqueueMail.mockClear();
    const patched = await request("PATCH", `/${event.id}/invitations/${byEmail[emailOf("stranger")].id}`, "owner", { email: `fixed-${runId}@example.com` });
    expect(patched.status).toBe(200);
    await dueNow(event.id);
    const report = await send(event.id);
    expect(report.skipped).toBeGreaterThanOrEqual(1);
    const to = enqueueMail.mock.calls.map(([m]) => m.to).sort();
    expect(to).toEqual([`fixed-${runId}@example.com`, `third-${runId}@example.com`].sort());
    expect(to).not.toContain(emailOf("guest"));
    expect(to).not.toContain(emailOf("stranger"));
  });

  test("an event switched away from invite-only before the mail goes out: it is skipped", async () => {
    const event = await createEvent();
    queueDown();
    await invite(event.id, [emailOf("guest")]);
    queueUp();
    enqueueMail.mockClear();
    await request("PATCH", `/${event.id}`, "owner", { status: "draft" });
    await dueNow(event.id);
    expect(await send(event.id)).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("duplicate workers send once; recipients that others invited are not touched; unauthorized callers record nothing", async () => {
    const event = await createEvent();
    expect((await invite(event.id, [emailOf("guest")], "other")).status).toBe(403);
    expect((await invite(event.id, [emailOf("guest")], "stranger")).status).toBe(403);
    expect(await outboxOf(event.id)).toEqual([]);

    queueDown();
    await invite(event.id, [emailOf("guest")]);
    queueUp();
    enqueueMail.mockClear();
    await dueNow(event.id);
    const reports = await Promise.all([send(event.id), send(event.id), send(event.id)]);
    expect(reports.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(enqueueMail).toHaveBeenCalledTimes(1);
  });

  test("a queue that keeps failing ends as failed with the attempts counted and only the error name kept", async () => {
    const event = await createEvent();
    queueDown();
    await invite(event.id, [emailOf("guest")]);
    const errors = mock(() => {});
    const original = console.error;
    console.error = errors;
    try {
      for (let attempt = 2; attempt <= 8; attempt++) {
        await dueNow(event.id);
        await send(event.id);
      }
    } finally {
      console.error = original;
    }
    const [row] = await outboxOf(event.id);
    expect(row).toMatchObject({ state: "failed", attempts: 8, lastError: "Error" });
    // nothing private in the logs
    expect(JSON.stringify(errors.mock.calls)).not.toContain("@example.com");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("queue down");
  });

  test("an invitation whose mail was skipped because the event went back to a draft is mailed when it is switched to invite-only again", async () => {
    const event = await createEvent();
    queueDown();
    const { invited } = await json(await invite(event.id, [emailOf("guest")]));
    await request("PATCH", `/${event.id}`, "owner", { status: "draft" });
    queueUp();
    enqueueMail.mockClear();
    await dueNow(event.id);
    expect(await send(event.id)).toEqual({ sent: 0, failed: 0, skipped: 1 });
    // unclaimed: it is owed again
    expect((await json(await request("GET", `/${event.id}/invitations`, "owner"))).items[0].notifiedAt).toBeNull();

    await request("PATCH", `/${event.id}`, "owner", { status: "invite" });
    await waitForMails(1);
    expect(mailedTo()).toEqual([emailOf("guest")]);
    expect((await outboxOf(event.id)).filter((r) => r.state === "sent")).toHaveLength(1);
    expect(invited).toHaveLength(1);
  });

  test("re-addressed and addressed back: the invitee gets one mail, and the address in between none", async () => {
    const event = await createEvent();
    queueDown();
    const { invited } = await json(await invite(event.id, [emailOf("guest")]));
    const id = invited[0].id;
    await request("PATCH", `/${event.id}/invitations/${id}`, "owner", { email: `between-${runId}@example.com` });
    await request("PATCH", `/${event.id}/invitations/${id}`, "owner", { email: emailOf("guest") });
    queueUp();
    enqueueMail.mockClear();
    await dueNow(event.id);
    await send(event.id);
    expect(mailedTo()).toEqual([emailOf("guest")]);
    expect((await outboxOf(event.id)).length).toBe(3);
  });

  test("more invitations than one dispatch's default are all sent by the call that recorded them", async () => {
    const event = await createEvent();
    const emails = Array.from({ length: 60 }, (_, i) => `bulk${i}-${runId}@example.com`);
    const response = await invite(event.id, emails);
    expect(response.status).toBe(200);
    expect(enqueueMail).toHaveBeenCalledTimes(60);
    expect((await outboxOf(event.id)).every((r) => r.state === "sent")).toBe(true);
  });

  test("an invitation saved with the mail recorded is not lost if the process dies before sending: nothing is left unmailed and unowed", async () => {
    const event = await createEvent();
    queueDown();
    await invite(event.id, [emailOf("guest")]);
    // (the process died here: only the rows exist)
    const list = (await json(await request("GET", `/${event.id}/invitations`, "owner"))).items;
    expect(list.every((i: any) => i.notifiedAt !== null)).toBe(true);
    expect((await outboxOf(event.id)).every((r) => r.state === "pending")).toBe(true);
  });
});
