import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { AuthSession, Role } from "@app/auth-guard";

const sessions = new Map<string, AuthSession>();
const resolve = async (headers: Headers) => sessions.get(headers.get("cookie") ?? "") ?? null;
const actual = { ...(await import("@app/auth-guard")) };
mock.module("@app/auth-guard", () => ({
  ...actual,
  authGuard: actual.createAuthGuard(resolve, "test"),
  authenticate: actual.createAuthenticator(resolve),
}));

// invite-only events email their invitees; never reach the real queue
mock.module("@app/mail", () => ({ enqueueMail: mock(async () => {}) }));

const { event: app } = await import("../src/app");
const { db, eventCategories, events, inArray, users } = await import("@app/db");

const runId = crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];
const categoryIds: string[] = [];
const eventIds: string[] = [];

async function seedUser(name: string, role: Role) {
  const [user] = await db
    .insert(users)
    .values({ name, email: `${name}-cat-${runId}@example.com`, role })
    .returning({ id: users.id, email: users.email });
  userIds.push(user!.id);
  sessions.set(name, {
    user: { id: user!.id, name, email: user!.email, image: null, role },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return user!.id;
}

const json = (response: Response): Promise<any> => response.json();
const request = (method: string, path: string, as?: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost/api/events/categories${path}`, {
      method,
      headers: { ...(as ? { cookie: as } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );

let organizerId: string;
beforeAll(async () => {
  organizerId = await seedUser("organizer", "organizer");
  await seedUser("admin", "admin");
});

afterAll(async () => {
  await db.delete(events).where(inArray(events.id, eventIds));
  await db.delete(eventCategories).where(inArray(eventCategories.id, categoryIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("categories", () => {
  test("anyone can list; only admins write", async () => {
    expect((await request("GET", "")).status).toBe(200);
    const body = { name: `n-${runId}`, slug: `n-${runId}` };
    expect((await request("POST", "", undefined, body)).status).toBe(401);
    expect((await request("POST", "", "organizer", body)).status).toBe(403);
    const created = await request("POST", "", "admin", body);
    expect(created.status).toBe(200);
    const category = await json(created);
    categoryIds.push(category.id);

    expect((await request("POST", "", "admin", body)).status).toBe(409);
    const renamed = await json(await request("PATCH", `/${category.id}`, "admin", { name: `m-${runId}` }));
    expect(renamed.name).toBe(`m-${runId}`);
    expect((await request("PATCH", `/${category.id}`, "organizer", { name: "x" })).status).toBe(403);
  });

  test("the English name: set, changed, cleared, and never blank", async () => {
    const created = await json(
      await request("POST", "", "admin", { name: `th-${runId}`, nameEn: `Music ${runId}`, slug: `en-${runId}` }),
    );
    categoryIds.push(created.id);
    expect(created.nameEn).toBe(`Music ${runId}`);

    // a category made without one has none, and the list carries the field
    const plain = await json(await request("POST", "", "admin", { name: `p-${runId}`, slug: `p-${runId}` }));
    categoryIds.push(plain.id);
    expect(plain.nameEn).toBeNull();
    const listed: any[] = await json(await request("GET", ""));
    expect(listed.find((c) => c.id === created.id)?.nameEn).toBe(`Music ${runId}`);

    // PATCH changes it, leaves it alone when absent, and null clears it
    const changed = await json(await request("PATCH", `/${created.id}`, "admin", { nameEn: `Live ${runId}` }));
    expect(changed.nameEn).toBe(`Live ${runId}`);
    const untouched = await json(await request("PATCH", `/${created.id}`, "admin", { name: `th2-${runId}` }));
    expect(untouched.nameEn).toBe(`Live ${runId}`);
    const cleared = await json(await request("PATCH", `/${created.id}`, "admin", { nameEn: null }));
    expect(cleared.nameEn).toBeNull();

    // an empty or blank English name is not a name: the form sends null to say "none"
    expect((await request("PATCH", `/${created.id}`, "admin", { nameEn: "" })).status).toBe(422);
    expect((await request("PATCH", `/${created.id}`, "admin", { nameEn: "   " })).status).toBe(422);
    // only admins, as for the Thai name
    expect((await request("PATCH", `/${created.id}`, "organizer", { nameEn: "x" })).status).toBe(403);
  });

  test("a category in use cannot be deleted", async () => {
    const category = await json(
      await request("POST", "", "admin", { name: `u-${runId}`, slug: `u-${runId}` }),
    );
    categoryIds.push(category.id);
    const [event] = await db
      .insert(events)
      .values({
        organizerId,
        categoryId: category.id,
        title: "T",
        slug: `cat-test-${runId}`,
        venue: "V",
        startsAt: new Date(),
        endsAt: new Date(),
      })
      .returning({ id: events.id });
    eventIds.push(event!.id);

    const blocked = await request("DELETE", `/${category.id}`, "admin");
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).code).toBe("CATEGORY_IN_USE");

    await db.delete(events).where(inArray(events.id, eventIds));
    expect((await request("DELETE", `/${category.id}`, "admin")).status).toBe(200);
    expect((await request("DELETE", `/${category.id}`, "admin")).status).toBe(404);
  });
});
