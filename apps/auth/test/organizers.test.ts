import { afterAll, beforeAll, expect, mock, test } from "bun:test";

// Keep test mail off the real queue (the worker may send through Gmail).
mock.module("@app/mail", () => ({ enqueueMail: mock(async () => {}) }));

const { authentication } = await import("../src/app");
const { db, eq, inArray, notificationOutbox, organizerApplications, users } = await import("@app/db");

const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";
const runId = crypto.randomUUID().slice(0, 8);
const createdEmails: string[] = [];

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
  const response = await call("/sign-up/email", "", {
    method: "POST",
    body: { name, email, password: "password1234" },
  });
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .find((value) => value.includes("session_token="));
  return { id: user.id, email, cookie: cookie! };
}

const body = (response: Response): Promise<any> => response.json();

let admin: Awaited<ReturnType<typeof signUp>>;
let organizer: Awaited<ReturnType<typeof signUp>>;
let member: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  admin = await signUp("admin");
  await db.update(users).set({ role: "admin" }).where(eq(users.email, admin.email));
  organizer = await signUp("organizer");
  member = await signUp("member");

  const applied = await call("/organizer-applications", organizer.cookie, {
    method: "POST",
    body: { organizationName: "ชมรมดนตรี", contact: "080-000-0000", reason: "จัดคอนเสิร์ตการกุศล" },
  });
  const { id } = await body(applied);
  expect((await call(`/organizer-applications/${id}/approve`, admin.cookie, { method: "POST" })).status).toBe(200);
});

afterAll(async () => {
  // the decision mails these applications recorded (the outbox points at the application by id, not by a foreign key)
  const ids = (await db.select({ id: users.id }).from(users).where(inArray(users.email, createdEmails))).map((r) => r.id);
  if (ids.length) {
    await db
      .delete(notificationOutbox)
      .where(inArray(notificationOutbox.subjectId, db.select({ id: organizerApplications.id }).from(organizerApplications).where(inArray(organizerApplications.userId, ids))));
  }
  await db.delete(users).where(inArray(users.email, createdEmails));
});

test("an approved organizer shows under their organization name, without private fields", async () => {
  const response = await call(`/organizers/${organizer.id}`, "");
  expect(response.status).toBe(200);
  const profile = await body(response);
  expect(profile).toEqual({
    id: organizer.id,
    name: "ชมรมดนตรี",
    image: null,
    organizerSince: expect.any(String),
  });
  expect(JSON.stringify(profile)).not.toContain(organizer.email);
  expect(JSON.stringify(profile)).not.toContain("080-000-0000");
});

test("an admin who never applied shows under their own name", async () => {
  expect(await body(await call(`/organizers/${admin.id}`, ""))).toEqual({
    id: admin.id,
    name: "admin",
    image: null,
    organizerSince: null,
  });
});

test("an organizer who lost the role keeps the profile their events point to", async () => {
  await db.update(users).set({ role: "user" }).where(eq(users.id, organizer.id));
  expect((await call(`/organizers/${organizer.id}`, "")).status).toBe(200);
  await db.update(users).set({ role: "organizer" }).where(eq(users.id, organizer.id));
});

test("plain users and unknown ids are not found alike", async () => {
  const plain = await call(`/organizers/${member.id}`, "");
  expect(plain.status).toBe(404);
  expect((await body(plain)).code).toBe("ORGANIZER_NOT_FOUND");
  expect((await call(`/organizers/${crypto.randomUUID()}`, "")).status).toBe(404);
  expect((await call("/organizers/not-a-uuid", "")).status).toBe(422);
});
