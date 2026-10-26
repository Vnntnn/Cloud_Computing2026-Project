import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

// The mail queue is a stand-in that can be told to fail; keep test mail off the real one.
const enqueueMail = mock(async (_message: unknown) => {});
mock.module("@app/mail", () => ({ enqueueMail }));

const { authentication } = await import("../src/app");
const { db, dispatchNotifications, ensureEpoch, eq, inArray, notificationOutbox, organizerApplications, outboxStatus, recordMissingResetMails, resumeNotifications, users, verifications } =
  await import("@app/db");

const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";
const runId = crypto.randomUUID().slice(0, 8);
const createdEmails: string[] = [];
// every subject this file made a mail owed for (a verification or an application), to clean its outbox rows up
const subjects = new Set<string>();
const MIN = 60_000;

function call(path: string, cookie: string, init: { method?: string; body?: unknown } = {}) {
  return authentication.handle(
    new Request(`http://localhost/api/auth${path}`, {
      method: init.method ?? "GET",
      headers: { cookie, origin, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function signUp(name: string) {
  const email = `${name}-${runId}@example.com`;
  createdEmails.push(email);
  const response = await call("/sign-up/email", "", { method: "POST", body: { name, email, password: "password1234" } });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]!).find((value) => value.includes("session_token="))!;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { email, cookie, id: user!.id };
}

const body = (response: Response): Promise<any> => response.json();
const requestReset = (email: string) => call("/request-password-reset", "", { method: "POST", body: { email, redirectTo: `${origin}/reset-password` } });
const tokensOf = async (userId: string) =>
  (await db.select({ id: verifications.id, identifier: verifications.identifier }).from(verifications).where(eq(verifications.value, userId))).map((row) => {
    subjects.add(row.id);
    return { id: row.id, token: row.identifier.replace("reset-password:", "") };
  });
const outboxFor = (subjectIds: string[]) => db.select().from(notificationOutbox).where(inArray(notificationOutbox.subjectId, subjectIds));
const send = (subjectIds: string[]) => dispatchNotifications((message) => enqueueMail(message), { subjectIds });
const queueDown = () =>
  enqueueMail.mockImplementation(async () => {
    throw new Error("queue down");
  });
const queueUp = () => enqueueMail.mockImplementation(async () => {});
const sentTo = () => enqueueMail.mock.calls.map(([m]) => (m as { to: string }).to);
const due = (subjectIds: string[]) => db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(inArray(notificationOutbox.subjectId, subjectIds));
/** The mail is sent in the background after the request: wait until the outbox row has settled. */
async function settled(subjectIds: string[]) {
  for (let i = 0; i < 100; i++) {
    const rows = await outboxFor(subjectIds);
    if (rows.length && rows.every((r) => r.state !== "pending" || r.lastError !== null)) return rows;
    await Bun.sleep(20);
  }
  return outboxFor(subjectIds);
}

let admin: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  admin = await signUp("admin");
  await db.update(users).set({ role: "admin" }).where(eq(users.email, admin.email));
  member = await signUp("member");
});

beforeEach(() => {
  enqueueMail.mockReset();
  enqueueMail.mockImplementation(async () => {});
});

afterAll(async () => {
  const ids = (await db.select({ id: users.id }).from(users).where(inArray(users.email, createdEmails))).map((r) => r.id);
  const verificationIds = ids.length ? (await db.select({ id: verifications.id }).from(verifications).where(inArray(verifications.value, ids))).map((r) => r.id) : [];
  const applicationIds = ids.length ? (await db.select({ id: organizerApplications.id }).from(organizerApplications).where(inArray(organizerApplications.userId, ids))).map((r) => r.id) : [];
  const all = [...new Set([...subjects, ...verificationIds, ...applicationIds])];
  if (all.length) await db.delete(notificationOutbox).where(inArray(notificationOutbox.subjectId, all));
  await db.delete(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `epoch:test-${runId}`));
  // every token this file made, including ones for a user that doesn't exist (they have no user to be found through)
  const tokenIds = [...new Set([...subjects, ...verificationIds])];
  if (tokenIds.length) await db.delete(verifications).where(inArray(verifications.id, tokenIds));
  await db.delete(users).where(inArray(users.email, createdEmails));
});

describe("password reset mail", () => {
  test("the request records that a mail is owed for the token, never the link; the mail is composed from the token when it is sent, once", async () => {
    const user = await signUp("reset1");
    expect((await requestReset(user.email)).status).toBe(200);
    const { id, token } = (await tokensOf(user.id))[0]!;
    const [row] = await settled([id!]);

    expect(row).toMatchObject({ kind: "reset-password", subjectId: id, state: "sent", dedupeKey: `reset-password:${id}` });
    // the token is in `verifications` (better-auth's), and nowhere in the outbox
    expect(row!.message).toBeNull();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(sentTo()).toEqual([user.email]);
    const mail = enqueueMail.mock.calls[0]![0] as { template: string; props: { url: string } };
    expect(mail.template).toBe("reset-password");
    expect(mail.props.url).toBe(`${origin}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(`${origin}/reset-password`)}`);

    // sent once: a second worker finds nothing
    expect(await send([id!])).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(enqueueMail).toHaveBeenCalledTimes(1);
  });

  test("a queue that is down, or a restart before it is sent: the request still succeeds, the mail waits with backoff and is sent later", async () => {
    const user = await signUp("reset2");
    queueDown();
    const errors = mock(() => {});
    const original = console.error;
    console.error = errors;
    try {
      expect((await requestReset(user.email)).status).toBe(200);
      const { id, token } = (await tokensOf(user.id))[0]!;
      const [row] = await settled([id!]);
      expect(row).toMatchObject({ state: "pending", attempts: 1, lastError: "Error" });
      expect(row!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      expect(outboxStatus(row!)).toBe("retry_scheduled");
      // the logs say what failed, not to whom or with which link
      expect(JSON.stringify(errors.mock.calls)).not.toContain(token);
      expect(JSON.stringify(errors.mock.calls)).not.toContain(user.email);

      queueUp();
      enqueueMail.mockClear();
      await due([id!]);
      expect(await send([id!])).toEqual({ sent: 1, failed: 0, skipped: 0 });
      expect(sentTo()).toEqual([user.email]);
      expect((enqueueMail.mock.calls[0]![0] as { props: { url: string } }).props.url).toContain(token);
    } finally {
      console.error = original;
    }
  });

  /** A reset token as better-auth stores it: made `ageMs` ago, valid for `expiresInMs` more, for `userId`. */
  const insertToken = async (userId: string, token: string, { ageMs, expiresInMs }: { ageMs: number; expiresInMs: number }) => {
    const [row] = await db
      .insert(verifications)
      .values({ identifier: `reset-password:${token}`, value: userId, expiresAt: new Date(Date.now() + expiresInMs), createdAt: new Date(Date.now() - ageMs) })
      .returning({ id: verifications.id });
    subjects.add(row!.id);
    return row!.id;
  };
  const epochName = `test-${runId}`;
  const setEpoch = async (ageMs: number) => {
    // the epoch is the sentinel row's creation time: place it `ageMs` ago
    await ensureEpoch(epochName);
    await db.update(notificationOutbox).set({ createdAt: new Date(Date.now() - ageMs) }).where(eq(notificationOutbox.dedupeKey, `epoch:${epochName}`));
  };
  const scan = (ids: string[]) => recordMissingResetMails({ verificationIds: ids, epochName });

  test("without an epoch nothing is recorded: tokens can't be told from ones mailed by the code before", async () => {
    const user = await signUp("reset3a");
    const id = await insertToken(user.id, `noepoch-${runId}`, { ageMs: 5 * MIN, expiresInMs: 50 * MIN });
    expect(await scan([id])).toBe(0);
    expect(await outboxFor([id])).toEqual([]);
  });

  test("an unrecorded token is recovered for the whole of its life, not just a quarter hour: a process outage of 40 minutes doesn't lose it", async () => {
    const user = await signUp("reset3b");
    await setEpoch(3 * 60 * MIN);
    const stranded = await insertToken(user.id, `stranded-${runId}`, { ageMs: 40 * MIN, expiresInMs: 20 * MIN });

    expect(await scan([stranded])).toBe(1);
    expect(await send([stranded])).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ to: user.email, template: "reset-password" });
    expect((enqueueMail.mock.calls[0]![0] as { props: { url: string } }).props.url).toContain(`stranded-${runId}`);
    // and the outbox row never held it
    expect(JSON.stringify(await outboxFor([stranded]))).not.toContain(`stranded-${runId}`);
  });

  test("which tokens are owed: not expired, not before the epoch, not too new, user still there, not already recorded; and repeated scans add nothing", async () => {
    const user = await signUp("reset3c");
    const gone = await signUp("reset3d");
    await setEpoch(45 * MIN);
    const live = await insertToken(user.id, `live-${runId}`, { ageMs: 3 * MIN, expiresInMs: 57 * MIN });
    const fresh = await insertToken(user.id, `fresh-${runId}`, { ageMs: 5_000, expiresInMs: 59 * MIN });
    const expired = await insertToken(user.id, `expired-${runId}`, { ageMs: 20 * MIN, expiresInMs: -MIN });
    // made before the epoch: the code before this one mailed it inline, and nobody can say whether it arrived
    const legacy = await insertToken(user.id, `legacy-${runId}`, { ageMs: 50 * MIN, expiresInMs: 10 * MIN });
    const recorded = await insertToken(user.id, `recorded-${runId}`, { ageMs: 4 * MIN, expiresInMs: 56 * MIN });
    await db.insert(notificationOutbox).values({ dedupeKey: `reset-password:${recorded}`, kind: "reset-password", subjectId: recorded, message: null, state: "sent" });
    // a token whose user was deleted
    const orphan = await insertToken("00000000-0000-4000-8000-000000000000", `orphan-${runId}`, { ageMs: 5 * MIN, expiresInMs: 55 * MIN });
    const subjectsHere = [live, fresh, expired, legacy, recorded, orphan];

    expect(await scan(subjectsHere)).toBe(1);
    expect((await outboxFor(subjectsHere)).map((r) => r.subjectId).sort()).toEqual([live, recorded].sort());
    // repeated: nothing new, however often
    expect(await scan(subjectsHere)).toBe(0);
    expect(await scan(subjectsHere)).toBe(0);
    expect((await outboxFor(subjectsHere)).length).toBe(2);
    expect(gone.id).not.toBe(user.id);
  });

  test("a token made after the epoch by an older pod (mailed inline, recorded nothing) is mailed once more by the scan, and then never again", async () => {
    const user = await signUp("reset3e");
    await setEpoch(10 * MIN);
    const inline = await insertToken(user.id, `inline-${runId}`, { ageMs: 3 * MIN, expiresInMs: 57 * MIN });
    expect(await scan([inline])).toBe(1);
    expect(await send([inline])).toEqual({ sent: 1, failed: 0, skipped: 0 });
    // bounded: the same link to the same person, once
    expect(await scan([inline])).toBe(0);
    expect(await send([inline])).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(sentTo()).toEqual([user.email]);
  });

  test("a token whose user is deleted after it is recorded is skipped when its time comes", async () => {
    const user = await signUp("reset3f");
    await setEpoch(60 * MIN);
    const id = await insertToken(user.id, `deleted-${runId}`, { ageMs: 5 * MIN, expiresInMs: 55 * MIN });
    expect(await scan([id])).toBe(1);
    await db.update(verifications).set({ value: "00000000-0000-4000-8000-000000000000" }).where(eq(verifications.id, id));
    expect(await send([id])).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("the recovery loop declares its epoch, then records, sends and retries what a crash left, by itself", async () => {
    const { startResetMailRecovery } = await import("../src/libs/reset-mail-recovery");
    const user = await signUp("reset3g");
    const name = `loop-${runId}`;
    const id = await insertToken(user.id, `loop-${runId}`, { ageMs: 2 * MIN, expiresInMs: 58 * MIN });
    // (scoped to this token: the loop is otherwise for every token and every owed mail in the database)
    const stop = await startResetMailRecovery({ intervalMs: 30, epochName: name, only: [id] });
    try {
      // the epoch is the loop's start: this token is older than it, so it is not the loop's to mail
      await Bun.sleep(300);
      expect(await outboxFor([id])).toEqual([]);
      // had the loop started just before it, it would be: the epoch moves to a second before the token
      await db.update(notificationOutbox).set({ createdAt: new Date(Date.now() - 2 * MIN - 1000) }).where(eq(notificationOutbox.dedupeKey, `epoch:${name}`));
      for (let waited = 0; waited < 3000 && !(await outboxFor([id])).some((r) => r.state === "sent"); waited += 50) await Bun.sleep(50);
      expect((await outboxFor([id])).map((r) => r.state)).toEqual(["sent"]);
      expect(sentTo()).toEqual([user.email]);

      // a deleted epoch is written again by the next pass, not left to silence the scan
      await db.delete(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `epoch:${name}`));
      for (let waited = 0; waited < 3000 && !(await db.select().from(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `epoch:${name}`))).length; waited += 50) await Bun.sleep(50);
      expect(await db.select().from(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `epoch:${name}`))).toHaveLength(1);

      // a recorded mail that failed to send is retried by the loop itself, with nothing new to record
      const second = await insertToken(user.id, `loop2-${runId}`, { ageMs: 2 * MIN, expiresInMs: 58 * MIN });
      await db.insert(notificationOutbox).values({ dedupeKey: `reset-password:${second}`, kind: "reset-password", subjectId: second, message: null, attempts: 1, lastError: "AbortError", nextAttemptAt: new Date(Date.now() - 1000) });
    } finally {
      await stop();
    }
    // (the second token was outside `only`, so it was not sent: shown by a loop scoped to it)
    expect(sentTo()).toEqual([user.email]);
    const second = (await db.select().from(verifications).where(eq(verifications.identifier, `reset-password:loop2-${runId}`)))[0]!;
    const retry = await startResetMailRecovery({ intervalMs: 30, epochName: name, only: [second.id] });
    try {
      for (let waited = 0; waited < 3000 && !(await outboxFor([second.id])).some((r) => r.state === "sent"); waited += 50) await Bun.sleep(50);
      expect((await outboxFor([second.id])).map((r) => r.state)).toEqual(["sent"]);
    } finally {
      await retry();
      await db.delete(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `epoch:${name}`));
    }
  });
  test("a token that is used or expired by the time the mail would go out is not mailed", async () => {
    const user = await signUp("reset4");
    queueDown();
    const original = console.error;
    console.error = () => {};
    try {
      await requestReset(user.email);
      const { id, token } = (await tokensOf(user.id))[0]!;
      await settled([id!]);
      queueUp();
      enqueueMail.mockClear();
      // the password is reset with that token (better-auth deletes it) before the retry comes round
      const done = await call("/reset-password", "", { method: "POST", body: { newPassword: "another-password-1", token } });
      expect(done.status).toBe(200);
      await due([id!]);
      expect(await send([id!])).toEqual({ sent: 0, failed: 0, skipped: 1 });
      expect(enqueueMail).not.toHaveBeenCalled();
      expect((await outboxFor([id!]))[0]!.state).toBe("skipped");

      // and one that expired
      await requestReset(user.email);
      const [second] = (await tokensOf(user.id)).filter((t) => t.id !== id);
      await settled([second!.id]);
      await db.update(verifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verifications.id, second!.id));
      await db.update(notificationOutbox).set({ state: "pending", attempts: 0, nextAttemptAt: null }).where(eq(notificationOutbox.subjectId, second!.id));
      expect(await send([second!.id])).toEqual({ sent: 0, failed: 0, skipped: 1 });
    } finally {
      console.error = original;
    }
  });

  test("an unknown address records and sends nothing (no way to tell who has an account)", async () => {
    const email = `nobody-${runId}@example.com`;
    const answer = await requestReset(email);
    expect(answer.status).toBe(200);
    expect((await body(answer)).message).toContain("If this email exists");
    await Bun.sleep(100);
    // no user, so no token and nothing owed or sent
    expect(await db.select({ id: users.id }).from(users).where(eq(users.email, email))).toEqual([]);
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("two requests give two tokens and two mails, each sent once even with workers racing", async () => {
    const user = await signUp("reset5");
    await requestReset(user.email);
    await requestReset(user.email);
    const tokens = await tokensOf(user.id);
    expect(tokens).toHaveLength(2);
    await settled(tokens.map((t) => t.id));
    expect(enqueueMail).toHaveBeenCalledTimes(2);
    enqueueMail.mockClear();
    await Promise.all([send(tokens.map((t) => t.id)), send(tokens.map((t) => t.id))]);
    expect(enqueueMail).not.toHaveBeenCalled();
  });
});

describe("organizer application mail", () => {
  const application = { organizationName: "ชมรมดนตรี", contact: "080-000-0000", reason: "จัดคอนเสิร์ตการกุศลทุกเดือน" };

  async function apply(name: string) {
    const user = await signUp(name);
    const created = await body(await call("/organizer-applications", user.cookie, { method: "POST", body: application }));
    subjects.add(created.id);
    return { user, id: created.id as string };
  }

  test("a decision committed with the queue down keeps its mail: sent later once, only while the application still has that decision", async () => {
    const { user, id } = await apply("app1");
    queueDown();
    const original = console.error;
    console.error = () => {};
    try {
      const approved = await call(`/organizer-applications/${id}/approve`, admin.cookie, { method: "POST" });
      expect((await body(approved)).status).toBe("approved");
      const [row] = await settled([id]);
      expect(row).toMatchObject({ kind: "organizer-approved", state: "pending", attempts: 1, dedupeKey: `organizer-approved:${id}` });

      queueUp();
      enqueueMail.mockClear();
      await due([id]);
      expect(await send([id])).toEqual({ sent: 1, failed: 0, skipped: 0 });
      expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ to: user.email, template: "organizer-approved", props: { organizationName: application.organizationName } });
      expect(await send([id])).toEqual({ sent: 0, failed: 0, skipped: 0 });
    } finally {
      console.error = original;
    }
  });

  test("a rejection's mail carries its note; a decision that is stale (the application is no longer rejected) is skipped", async () => {
    const { user, id } = await apply("app2");
    queueDown();
    const original = console.error;
    console.error = () => {};
    try {
      await call(`/organizer-applications/${id}/reject`, admin.cookie, { method: "POST", body: { note: "ยังไม่ครบ" } });
      await settled([id]);
    } finally {
      console.error = original;
    }
    queueUp();
    enqueueMail.mockClear();
    await due([id]);
    expect(await send([id])).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(enqueueMail.mock.calls[0]![0]).toMatchObject({ to: user.email, template: "organizer-rejected", props: { note: "ยังไม่ครบ" } });

    // a second application, rejected with the queue down, then changed to approved by hand before the retry: the rejection mail must not go
    const second = await apply("app3");
    queueDown();
    console.error = () => {};
    try {
      await call(`/organizer-applications/${second.id}/reject`, admin.cookie, { method: "POST", body: {} });
      await settled([second.id]);
    } finally {
      console.error = original;
    }
    queueUp();
    enqueueMail.mockClear();
    await db.update(organizerApplications).set({ status: "approved" }).where(eq(organizerApplications.id, second.id));
    await due([second.id]);
    expect(await send([second.id])).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(enqueueMail).not.toHaveBeenCalled();
  });

  test("unauthorized and repeated decisions record no mail", async () => {
    const { id } = await apply("app4");
    expect((await call(`/organizer-applications/${id}/approve`, member.cookie, { method: "POST" })).status).toBe(403);
    expect((await call(`/organizer-applications/${id}/approve`, "", { method: "POST" })).status).toBe(401);
    expect(await outboxFor([id])).toEqual([]);

    await call(`/organizer-applications/${id}/approve`, admin.cookie, { method: "POST" });
    await settled([id]);
    const again = await call(`/organizer-applications/${id}/reject`, admin.cookie, { method: "POST", body: {} });
    expect(again.status).toBe(409);
    await call(`/organizer-applications/${id}/approve`, admin.cookie, { method: "POST" });
    expect((await outboxFor([id])).map((r) => r.kind)).toEqual(["organizer-approved"]);
    expect(enqueueMail).toHaveBeenCalledTimes(1);
  });

  test("failed notifications can be resumed, and are sent only if what they announce still holds", async () => {
    const { id } = await apply("app5");
    queueDown();
    const original = console.error;
    console.error = () => {};
    try {
      await call(`/organizer-applications/${id}/approve`, admin.cookie, { method: "POST" });
      await settled([id]);
      await db.update(notificationOutbox).set({ state: "failed", attempts: 8, lastError: "Error", nextAttemptAt: null }).where(eq(notificationOutbox.subjectId, id));
    } finally {
      console.error = original;
    }
    expect(await resumeNotifications({ subjectId: id })).toBe(1);
    const [row] = await outboxFor([id]);
    expect(row).toMatchObject({ state: "pending", attempts: 0, lastError: null });
    queueUp();
    enqueueMail.mockClear();
    expect(await send([id])).toEqual({ sent: 1, failed: 0, skipped: 0 });
  });
});
