import { afterAll, beforeAll, expect, test } from "bun:test";

// The real mail client (no mock) pointed at a server that accepts a request and never answers, through the outbox's own dispatcher:
// what a black-holed queue does to a notification's state. (Not AWS SQS: a local stand-in with the same silence.)
const silent = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
process.env.SQS_ENDPOINT = `http://127.0.0.1:${silent.port}`;
process.env.MAIL_QUEUE_URL = `http://127.0.0.1:${silent.port}/000000000000/mail-queue`;
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "x";
process.env.AWS_SECRET_ACCESS_KEY = "x";

const { enqueueMail } = await import("@app/mail");
const { db, dispatchNotifications, eq, notificationOutbox, outboxStatus, users, verifications } = await import("@app/db");

const runId = crypto.randomUUID().slice(0, 8);
let userId: string;
let verificationId: string;
const token = `silent-${runId}`;

beforeAll(async () => {
  const [user] = await db.insert(users).values({ name: "q", email: `q-${runId}@example.com` }).returning({ id: users.id });
  userId = user!.id;
  const [verification] = await db
    .insert(verifications)
    .values({ identifier: `reset-password:${token}`, value: userId, expiresAt: new Date(Date.now() + 3_600_000) })
    .returning({ id: verifications.id });
  verificationId = verification!.id;
  await db.insert(notificationOutbox).values({ dedupeKey: `reset-password:${verificationId}`, kind: "reset-password", subjectId: verificationId, message: null });
});

afterAll(async () => {
  silent.stop(true);
  await db.delete(notificationOutbox).where(eq(notificationOutbox.subjectId, verificationId));
  await db.delete(verifications).where(eq(verifications.id, verificationId));
  await db.delete(users).where(eq(users.id, userId));
});

const row = async () => (await db.select().from(notificationOutbox).where(eq(notificationOutbox.subjectId, verificationId)))[0]!;

test("a send that times out is a delivery failure: the row is not marked sent, keeps its backoff, stays recoverable, and the log has no secret", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(JSON.stringify(args));
  const started = Date.now();
  try {
    const report = await dispatchNotifications((message) => enqueueMail(message, { timeoutMs: 400 }), { subjectId: verificationId });
    expect(report).toEqual({ sent: 0, failed: 1, skipped: 0 });
  } finally {
    console.error = original;
  }
  // bounded by the timeout, not by the SDK's own retries
  expect(Date.now() - started).toBeLessThan(4000);

  const failed = await row();
  expect(failed).toMatchObject({ state: "pending", attempts: 1, lastError: "AbortError", sentAt: null });
  expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);
  expect(outboxStatus(failed)).toBe("retry_scheduled");
  // the message was composed from the token and never stored; the log names the kind and the error, nothing else
  expect(JSON.stringify(failed)).not.toContain(token);
  const text = logged.join("\n");
  expect(text).toContain("reset-password");
  expect(text).toContain("AbortError");
  expect(text).not.toContain(token);
  expect(text).not.toContain("example.com");

  // not before its backoff, however many workers ask
  const early = await Promise.all([
    dispatchNotifications((message) => enqueueMail(message, { timeoutMs: 400 }), { subjectId: verificationId }),
    dispatchNotifications((message) => enqueueMail(message, { timeoutMs: 400 }), { subjectId: verificationId }),
  ]);
  expect(early).toEqual([{ sent: 0, failed: 0, skipped: 0 }, { sent: 0, failed: 0, skipped: 0 }]);
  expect((await row()).attempts).toBe(1);
});

test("once the queue answers (and the backoff has passed), the same row is sent once, by exactly one of several workers", async () => {
  await db.update(notificationOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(notificationOutbox.subjectId, verificationId));
  const sent: unknown[] = [];
  const working = async (message: unknown) => void sent.push(message);
  const reports = await Promise.all([1, 2, 3].map(() => dispatchNotifications(working, { subjectId: verificationId })));
  expect(reports.reduce((n, r) => n + r.sent, 0)).toBe(1);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ to: `q-${runId}@example.com`, template: "reset-password" });
  expect(await row()).toMatchObject({ state: "sent", attempts: 2 });
});
