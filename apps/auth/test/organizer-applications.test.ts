import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

// Keep test mail off the real queue (the worker may send through Gmail).
const enqueueMail = mock(async () => {});
mock.module("@app/mail", () => ({ enqueueMail }));

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
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .find((value) => value.includes("session_token="));
  return { email, cookie: cookie! };
}

// response bodies are asserted field by field, so untyped is fine here
const body = (response: Response): Promise<any> => response.json();

const roleOf = async (email: string) =>
  (await db.select({ role: users.role }).from(users).where(eq(users.email, email)))[0]?.role;

const application = {
  organizationName: "ชมรมดนตรี",
  contact: "080-000-0000",
  reason: "จัดคอนเสิร์ตการกุศลทุกเดือน",
};

let admin: { email: string; cookie: string };
let applicant: { email: string; cookie: string };

beforeAll(async () => {
  admin = await signUp("admin");
  await db.update(users).set({ role: "admin" }).where(eq(users.email, admin.email));
  applicant = await signUp("applicant");
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

test("GET /providers reports whether Google login is configured", async () => {
  const response = await call("/providers", "");
  expect(await body(response)).toEqual({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
});

test("requires a session", async () => {
  expect((await call("/organizer-applications/me", "")).status).toBe(401);
});

describe("applying and approving", () => {
  let applicationId: string;

  test("a user applies once while pending", async () => {
    const first = await call("/organizer-applications", applicant.cookie, {
      method: "POST",
      body: application,
    });
    expect(first.status).toBe(200);
    const created = await body(first);
    expect(created).toMatchObject({ ...application, status: "pending", reviewNote: null });
    applicationId = created.id;

    const second = await call("/organizer-applications", applicant.cookie, {
      method: "POST",
      body: application,
    });
    expect(second.status).toBe(409);
    expect((await body(second)).code).toBe("APPLICATION_PENDING");
  });

  test("validates the body", async () => {
    const response = await call("/organizer-applications", applicant.cookie, {
      method: "POST",
      body: { ...application, reason: "สั้น" },
    });
    expect(response.status).toBe(422);
  });

  test("GET /me returns the latest application", async () => {
    const response = await call("/organizer-applications/me", applicant.cookie);
    expect((await body(response)).application.id).toBe(applicationId);
  });

  test("only admins list applications", async () => {
    expect((await call("/organizer-applications", applicant.cookie)).status).toBe(403);

    const response = await call("/organizer-applications?status=pending", admin.cookie);
    expect(response.status).toBe(200);
    const list = await body(response);
    expect(list.find((item: { id: string }) => item.id === applicationId)?.applicant.email).toBe(
      applicant.email,
    );
  });

  test("approving makes the applicant an organizer and mails them", async () => {
    enqueueMail.mockClear();
    const response = await call(`/organizer-applications/${applicationId}/approve`, admin.cookie, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect((await body(response)).status).toBe("approved");
    expect(await roleOf(applicant.email)).toBe("organizer");

    await Bun.sleep(50); // mail is enqueued without blocking the response
    expect(enqueueMail).toHaveBeenCalledTimes(1);
  });

  test("an application is reviewed only once", async () => {
    const again = await call(`/organizer-applications/${applicationId}/approve`, admin.cookie, {
      method: "POST",
    });
    expect(again.status).toBe(409);

    const missing = await call(
      `/organizer-applications/${crypto.randomUUID()}/approve`,
      admin.cookie,
      { method: "POST" },
    );
    expect(missing.status).toBe(404);
  });

  test("an organizer can no longer apply", async () => {
    const response = await call("/organizer-applications", applicant.cookie, {
      method: "POST",
      body: application,
    });
    expect(response.status).toBe(403);
  });
});

test("rejecting stores the note and lets the user apply again", async () => {
  const user = await signUp("rejected");
  const created = await body(
    await call("/organizer-applications", user.cookie, { method: "POST", body: application }),
  );

  const response = await call(`/organizer-applications/${created.id}/reject`, admin.cookie, {
    method: "POST",
    body: { note: "ข้อมูลติดต่อไม่ครบ" },
  });
  expect(response.status).toBe(200);
  expect(await body(response)).toMatchObject({ status: "rejected", reviewNote: "ข้อมูลติดต่อไม่ครบ" });
  expect(await roleOf(user.email)).toBe("user");

  const reapply = await call("/organizer-applications", user.cookie, {
    method: "POST",
    body: application,
  });
  expect(reapply.status).toBe(200);
});

describe("history", () => {
  let user: { email: string; cookie: string };
  const ids: string[] = [];

  beforeAll(async () => {
    user = await signUp("history");
  });

  test("cancelling keeps the application as cancelled and lets the user apply again", async () => {
    const created = await body(
      await call("/organizer-applications", user.cookie, { method: "POST", body: application }),
    );
    ids.push(created.id);

    const cancel = await call("/organizer-applications/me", user.cookie, { method: "DELETE" });
    expect(cancel.status).toBe(200);
    expect(await body(cancel)).toMatchObject({ id: created.id, status: "cancelled" });

    const latest = await body(await call("/organizer-applications/me", user.cookie));
    expect(latest.application).toMatchObject({ id: created.id, status: "cancelled" });

    const reapply = await call("/organizer-applications", user.cookie, { method: "POST", body: application });
    expect(reapply.status).toBe(200);
    ids.push((await body(reapply)).id);
  });

  test("GET /me/history lists every application, newest first", async () => {
    const response = await call("/organizer-applications/me/history", user.cookie);
    expect(response.status).toBe(200);
    const history = await body(response);
    expect(history.map((item: { id: string }) => item.id)).toEqual([...ids].reverse());
    expect(history.map((item: { status: string }) => item.status)).toEqual(["pending", "cancelled"]);
  });

  test("admins filter the list by applicant", async () => {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, user.email));
    const userId = row!.id;
    const response = await call(`/organizer-applications?userId=${userId}`, admin.cookie);
    expect(response.status).toBe(200);
    const list = await body(response);
    expect(list.map((item: { id: string }) => item.id).sort()).toEqual([...ids].sort());
    expect(list.every((item: { applicant: { id: string } }) => item.applicant.id === userId)).toBe(true);
  });
});
