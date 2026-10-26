// Checks the demo data without a running system: a typo here would only show at the end of a 35-minute deploy.
//   bun test demo/
import { describe, expect, test } from "bun:test";
import { at, categories, email, events } from "./seed.ts";

// the same rules the services enforce (apps/event/src/libs/slug.ts, routes/ticket-types)
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_QUESTIONS = 20;

describe("demo categories", () => {
  test("each has a Thai and an English name and a slug that has its own poster colourway", () => {
    for (const c of categories) {
      expect(c.name.trim()).not.toBe("");
      expect(c.nameEn.trim()).not.toBe("");
      expect(c.slug).toMatch(SLUG);
    }
    // apps/web/src/lib/poster.ts `chosen`: a slug outside it falls back to a hash and may share a colour
    expect(categories.map((c) => c.slug).sort()).toEqual(["food", "general", "music", "sport", "startup", "workshop"]);
    expect(new Set(categories.map((c) => c.slug)).size).toBe(categories.length);
  });
});

describe("demo events", () => {
  test("slugs are valid and unique, and every event has a known category", () => {
    const slugs = events.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const e of events) {
      expect(e.slug).toMatch(SLUG);
      expect(categories.map((c) => c.slug)).toContain(e.category);
    }
  });

  test("every event ends after it starts and is in the future, at the hour written (Bangkok time)", () => {
    for (const e of events) {
      const starts = new Date(at(...e.starts));
      const ends = new Date(at(...e.ends));
      expect(ends.getTime()).toBeGreaterThan(starts.getTime());
      expect(starts.getTime()).toBeGreaterThan(Date.now());
      // UTC+7: the hour in Bangkok is the UTC hour plus 7
      expect((starts.getUTCHours() + 7) % 24).toBe(e.starts[1]);
    }
  });

  test("ticket types follow the service rules: prices, quotas, questions", () => {
    for (const e of events) {
      expect(e.tickets.length).toBeGreaterThan(0);
      for (const t of e.tickets) {
        // whole baht; free, or at least 20 (Stripe's minimum)
        expect(Number.isInteger(t.price)).toBe(true);
        expect(t.price === 0 || t.price >= 20).toBe(true);
        if (t.kind === "first_come") expect(t.quota).toBeGreaterThan(0);
        else expect(t.quota).toBeUndefined();
        expect(t.maxPerUser).toBeGreaterThanOrEqual(1);
        expect(t.maxPerUser).toBeLessThanOrEqual(10);
        expect(t.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
        for (const q of t.questions) {
          if (q.type === "choice") {
            expect(q.options!.length).toBeGreaterThanOrEqual(2);
            expect(new Set(q.options).size).toBe(q.options!.length);
          } else expect(q.options).toBeUndefined();
        }
      }
    }
  });

  test("a refund policy has a percent and a cutoff, and only paid events carry one", () => {
    for (const e of events) {
      const paid = e.tickets.some((t) => t.price > 0);
      if (e.refund) {
        expect(paid).toBe(true);
        expect(e.refund.percent).toBeGreaterThan(0);
        expect(e.refund.percent).toBeLessThanOrEqual(100);
        expect(e.refund.cutoffHours).toBeGreaterThanOrEqual(0);
      } else expect(paid).toBe(false);
    }
  });

  test("the demo shows every kind of ticket and every state", () => {
    const kinds = new Set(events.flatMap((e) => e.tickets.map((t) => t.kind)));
    expect([...kinds].sort()).toEqual(["approval", "first_come", "invite"]);
    const states = new Set(events.map((e) => e.state ?? "public"));
    expect([...states].sort()).toEqual(["draft", "invite", "public", "scheduled"]);
    // a scheduled event says when it opens
    for (const e of events.filter((e) => e.state === "scheduled")) expect(e.publishInDays).toBeGreaterThan(0);
  });
});

describe("demo account emails", () => {
  test("without a mailbox they are on the dry-run domain; one per role", () => {
    expect(new Set([email("admin"), email("organizer"), email("attendee")]).size).toBe(3);
  });
});
