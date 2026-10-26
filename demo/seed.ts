// Seeds a prepared demo into a running Eventide through its public API: three accounts (admin, an approved
// organizer, an attendee), six categories with Thai and English names, and a set of events that shows every kind of
// ticket (first come / approval / invite), a paid ticket with a refund policy, registration questions, a draft and
// a scheduled event. It is idempotent: when the demo accounts already exist it does nothing.
//
//   BASE_URL=https://eventide.creasy.club bun demo/seed.ts
//
// Environment:
//   BASE_URL            required. The public origin (cookies and CORS-style origin checks use it).
//   PROMOTE_CMD         how to make a user an admin; {email} is replaced. Default `bash scripts/admin.sh {email}` (a
//                       one-off pod in the cluster). Locally: `bun --cwd apps/auth run admin:promote {email}`.
//   DEMO_PASSWORD       the password of the three accounts. Default: a random one, written to DEMO_OUT.
//   DEMO_MAIL_USER      a real mailbox, e.g. you@gmail.com. The accounts become you+demo-admin@gmail.com, ... (Gmail
//                       delivers them all to you). Approving the organizer sends a real mail, and an address nobody
//                       owns would bounce and end up in the dead-letter queue. Default: from GMAIL_USER in the
//                       environment; without one the accounts use @eventide.test (fine when mail runs dry).
//   DEMO_INVITE_EMAILS  comma-separated real addresses to invite to the invite-only event (invitations send mail).
//   DEMO_OUT            where the credentials are written (mode 600). Default demo/.credentials (gitignored).
//
// Nothing here enrolls or pays: those paths send real mail and touch Stripe.
import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const PROMOTE_CMD = process.env.PROMOTE_CMD ?? "bash scripts/admin.sh {email}";
const OUT = process.env.DEMO_OUT ?? "demo/.credentials";
const PASSWORD = process.env.DEMO_PASSWORD ?? `${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}Aa1!`;

const mailbox = (process.env.DEMO_MAIL_USER ?? process.env.GMAIL_USER ?? "").trim();
const email = (tag: string) => {
  const [local, domain] = mailbox.includes("@") ? mailbox.split("@") : [];
  return local && domain ? `${local}+demo-${tag}@${domain}` : `demo-${tag}@eventide.test`;
};

// ---- a tiny API client with one cookie jar per account ---------------------------------------------------------------
class Session {
  private cookies = new Map<string, string>();
  constructor(readonly label: string) {}

  async call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        origin: BASE,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const at = pair!.indexOf("=");
      if (at > 0) this.cookies.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
    const text = await response.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON: keep the text
    }
    return { status: response.status, data };
  }

  /** Like `call`, but a failure stops the seed and says which step and what the service answered. */
  async ok(step: string, method: string, path: string, body?: unknown) {
    const { status, data } = await this.call(method, path, body);
    if (status < 200 || status >= 300) {
      throw new Error(`${step}: ${method} ${path} -> ${status} ${typeof data === "string" ? data : JSON.stringify(data)}`.slice(0, 500));
    }
    return data;
  }
}

// ---- time: events are relative to "now" so the demo is always upcoming, and set in Bangkok time (UTC+7) --------------
const at = (days: number, hour: number, minute = 0) => {
  const base = new Date(Date.now() + days * 86_400_000);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour - 7, minute)).toISOString();
};

// ---- the data ---------------------------------------------------------------------------------------------------------
// slugs music/startup/sport/food/workshop/general have their own poster colourway (apps/web/src/lib/poster.ts)
const categories = [
  { slug: "general", name: "ทั่วไป", nameEn: "General" },
  { slug: "music", name: "ดนตรี", nameEn: "Music" },
  { slug: "startup", name: "สตาร์ทอัพ", nameEn: "Startup" },
  { slug: "sport", name: "กีฬา", nameEn: "Sports" },
  { slug: "food", name: "อาหารและตลาด", nameEn: "Food & Markets" },
  { slug: "workshop", name: "เวิร์กช็อป", nameEn: "Workshop" },
];

type Question = { type: "short_text" | "long_text" | "choice"; label: string; required: boolean; options?: string[] };
type Ticket = { kind: "first_come" | "approval" | "invite"; name: string; description?: string; price: number; quota?: number; maxPerUser: number; questions: Question[] };
type DemoEvent = {
  slug: string;
  category: string;
  title: string;
  venue: string;
  venueDescription?: string;
  starts: [days: number, hour: number, minute?: number];
  ends: [days: number, hour: number, minute?: number];
  description: string;
  tickets: Ticket[];
  /** public (default) | draft | invite | scheduled (public, but the page opens in `publishInDays` days) */
  state?: "public" | "draft" | "invite" | "scheduled";
  publishInDays?: number;
  refund?: { percent: number; cutoffHours: number };
};

const events: DemoEvent[] = [
  {
    slug: "bangkok-jazz-night",
    category: "music",
    title: "Bangkok Jazz Night",
    venue: "Blue Note Bangkok, Sukhumvit 24",
    venueDescription: "Five minutes from BTS Phrom Phong, exit 4. Doors open at 18:30.",
    starts: [12, 19, 30],
    ends: [12, 22, 30],
    description:
      "<h2>An evening of live jazz</h2><p>Three sets from the city's best quartets, with a late jam where anyone can sit in. <strong>Seats are limited</strong>, tables are first come.</p><ul><li>19:30 doors and welcome drinks</li><li>20:00 first set</li><li>21:30 open jam</li></ul>",
    tickets: [
      { kind: "first_come", name: "General admission", description: "Standing and bar seating", price: 450, quota: 120, maxPerUser: 4, questions: [] },
      {
        kind: "first_come",
        name: "VIP table",
        description: "A reserved table for two near the stage, with a welcome drink",
        price: 1200,
        quota: 20,
        maxPerUser: 2,
        questions: [{ type: "choice", label: "Any dietary needs?", required: false, options: ["None", "Vegetarian", "Halal", "Allergies (tell us at the door)"] }],
      },
    ],
    refund: { percent: 80, cutoffHours: 48 },
  },
  {
    slug: "startup-pitch-night-5",
    category: "startup",
    title: "Startup Pitch Night #5",
    venue: "True Digital Park, Bangkok",
    starts: [9, 18, 0],
    ends: [9, 21, 0],
    description:
      "<h2>Five founders, five minutes each</h2><p>Pitch to a panel of investors and operators, then mingle. Founders apply for a slot and the organizer approves each one; everyone else just registers to listen.</p>",
    tickets: [
      {
        kind: "approval",
        name: "Founder pitch slot",
        description: "The organizer approves each application",
        price: 0,
        maxPerUser: 1,
        questions: [
          { type: "short_text", label: "Startup name", required: true },
          { type: "choice", label: "Stage", required: true, options: ["Idea", "Prototype", "Early revenue", "Growth"] },
          { type: "long_text", label: "What problem do you solve? (a few sentences)", required: true },
        ],
      },
      { kind: "first_come", name: "Audience", price: 0, quota: 150, maxPerUser: 2, questions: [] },
    ],
  },
  {
    slug: "street-photography-workshop",
    category: "workshop",
    title: "เวิร์กช็อปถ่ายภาพสตรีทด้วยมือถือ",
    venue: "Bangkok Art and Culture Centre, ปทุมวัน",
    starts: [18, 9, 0],
    ends: [18, 16, 0],
    description:
      "<h2>ออกไปถ่ายภาพจริงกับช่างภาพมืออาชีพ</h2><p>เรียนองค์ประกอบภาพ แสง และการเล่าเรื่อง แล้วออกถ่ายรอบสยามพร้อมรีวิวภาพกันทั้งกลุ่ม <strong>ใช้แค่มือถือ</strong> ไม่ต้องมีกล้อง</p><ul><li>09:00 ทฤษฎีและตัวอย่างงาน</li><li>11:00 ออกถ่ายภาพ</li><li>14:00 รีวิวภาพ</li></ul>",
    tickets: [
      {
        kind: "first_come",
        name: "ตั๋วเข้าร่วม",
        description: "รวมอาหารกลางวันและเครื่องดื่ม",
        price: 590,
        quota: 25,
        maxPerUser: 2,
        questions: [{ type: "short_text", label: "รุ่นมือถือที่ใช้", required: false }],
      },
    ],
    refund: { percent: 100, cutoffHours: 72 },
  },
  {
    slug: "chiang-mai-street-food-festival",
    category: "food",
    title: "Chiang Mai Street Food Festival",
    venue: "ลานหน้าประตูท่าแพ เชียงใหม่",
    starts: [30, 11, 0],
    ends: [30, 21, 0],
    description:
      "<h2>Forty stalls, one long street</h2><p>Northern Thai classics, night-market snacks and a live stage. <strong>Entry is free</strong>: register to get the stall map and a lucky draw ticket.</p>",
    tickets: [{ kind: "first_come", name: "Free entry", price: 0, quota: 1000, maxPerUser: 6, questions: [] }],
  },
  {
    slug: "bangkok-community-run-10k",
    category: "sport",
    title: "Bangkok Community Run 10K",
    venue: "สวนลุมพินี กรุงเทพฯ",
    starts: [40, 5, 0],
    ends: [40, 9, 0],
    description:
      "<h2>10 km through the city's green lung</h2><p>A flat, shaded loop with water points every 2.5 km. Race pack, shirt and finisher medal included.</p>",
    tickets: [
      {
        kind: "first_come",
        name: "10K runner",
        price: 350,
        quota: 400,
        maxPerUser: 2,
        questions: [
          { type: "choice", label: "Shirt size", required: true, options: ["S", "M", "L", "XL"] },
          { type: "short_text", label: "Emergency contact (name and phone)", required: true },
        ],
      },
    ],
    refund: { percent: 50, cutoffHours: 168 },
  },
  {
    slug: "eventide-product-day",
    category: "general",
    title: "Eventide Product Day (private preview)",
    venue: "Eventide HQ, Bangkok",
    starts: [14, 14, 0],
    ends: [14, 17, 0],
    description: "<p>A private preview for invited guests only. Only the email addresses on the guest list can open this page and take a seat.</p>",
    tickets: [{ kind: "invite", name: "Guest", price: 0, maxPerUser: 1, questions: [] }],
    state: "invite",
  },
  {
    slug: "year-end-gala-2026",
    category: "general",
    title: "Year-End Gala 2026",
    venue: "Mandarin Oriental, Bangkok",
    starts: [70, 18, 30],
    ends: [70, 23, 0],
    description: "<p>Tickets open soon. This event is scheduled: the page is hidden from the public until its publish time.</p>",
    tickets: [{ kind: "first_come", name: "Gala ticket", price: 2500, quota: 200, maxPerUser: 4, questions: [] }],
    state: "scheduled",
    publishInDays: 3,
    refund: { percent: 80, cutoffHours: 168 },
  },
  {
    slug: "community-meetup-draft",
    category: "general",
    title: "Community Meetup (draft)",
    venue: "TBD",
    starts: [50, 18, 0],
    ends: [50, 20, 0],
    description: "<p>Still being planned. This draft shows how unpublished events look in the organizer's dashboard.</p>",
    tickets: [{ kind: "first_come", name: "Member", price: 0, quota: 60, maxPerUser: 2, questions: [] }],
    state: "draft",
  },
];

// ---- the run -----------------------------------------------------------------------------------------------------------
const accounts = {
  admin: { email: email("admin"), name: "Demo Admin", firstName: "Demo", lastName: "Admin" },
  organizer: { email: email("organizer"), name: "Somchai Jaidee", firstName: "Somchai", lastName: "Jaidee" },
  attendee: { email: email("attendee"), name: "Anna Rattanakul", firstName: "Anna", lastName: "Rattanakul" },
} as const;

const sessions = { admin: new Session("admin"), organizer: new Session("organizer"), attendee: new Session("attendee") };

async function signUp(who: keyof typeof accounts): Promise<boolean> {
  const a = accounts[who];
  const { status, data } = await sessions[who].call("POST", "/api/auth/sign-up/email", { ...a, password: PASSWORD });
  if (status >= 200 && status < 300) return true;
  if (data?.code === "USER_ALREADY_EXISTS" || data?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return false;
  throw new Error(`sign-up ${who}: ${status} ${JSON.stringify(data)}`.slice(0, 400));
}

const signIn = (who: keyof typeof accounts) =>
  sessions[who].ok(`sign-in ${who}`, "POST", "/api/auth/sign-in/email", { email: accounts[who].email, password: PASSWORD });

let created = false; // true once the first account exists: only then can a failure leave a partial demo

async function main() {
  if (!BASE) throw new Error("BASE_URL is required, e.g. BASE_URL=https://eventide.creasy.club bun demo/seed.ts");
  console.log(`demo: seeding ${BASE}`);
  const health = await fetch(`${BASE}/api/events/health`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!health?.ok) throw new Error(`${BASE}/api/events/health does not answer 200: is the system up?`);

  // 1. accounts. If the admin exists the demo has been seeded before: leave everything as it is.
  if (!(await signUp("admin"))) {
    console.log("demo: already seeded (the demo admin exists); nothing to do");
    return;
  }
  created = true;
  await signUp("organizer");
  await signUp("attendee");

  // 2. the admin: promoted outside the API (no endpoint makes an admin, by design), then a fresh sign-in sees the role
  const promote = spawnSync(PROMOTE_CMD.replaceAll("{email}", accounts.admin.email), { shell: true, stdio: "inherit" });
  if (promote.status !== 0) throw new Error(`promoting the demo admin failed (exit ${promote.status}): ${PROMOTE_CMD}`);
  await signIn("admin");

  // 3. the organizer applies, the admin approves: the event pages then show "organized by <organization>"
  const application = await sessions.organizer.ok("organizer application", "POST", "/api/auth/organizer-applications", {
    organizationName: "Siam Live Events",
    contact: accounts.organizer.email,
    reason: "We run live music, food and community events in Bangkok and want to sell tickets through Eventide.",
  });
  await sessions.admin.ok("approve organizer", "POST", `/api/auth/organizer-applications/${application.id}/approve`);
  await signIn("organizer"); // the role changed: sign in again for a session that has it

  // 4. categories (created, or given their English name if they already exist, like the built-in "general")
  const existing: any[] = await sessions.admin.ok("list categories", "GET", "/api/events/categories");
  const categoryId = new Map<string, string>();
  for (const c of categories) {
    const found = existing.find((e) => e.slug === c.slug);
    if (!found) {
      const made = await sessions.admin.ok(`category ${c.slug}`, "POST", "/api/events/categories", c);
      categoryId.set(c.slug, made.id);
    } else {
      categoryId.set(c.slug, found.id);
      if (!found.nameEn) await sessions.admin.ok(`category ${c.slug} English name`, "PATCH", `/api/events/categories/${found.id}`, { nameEn: c.nameEn });
    }
  }

  // 5. events: create, add ticket types, then set the state. A public event needs its ticket types first.
  const invites = (process.env.DEMO_INVITE_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const e of events) {
    const created = await sessions.organizer.ok(`event ${e.slug}`, "POST", "/api/events", {
      title: e.title,
      slug: e.slug,
      categoryId: categoryId.get(e.category),
      venue: e.venue,
      ...(e.venueDescription ? { venueDescription: e.venueDescription } : {}),
      startsAt: at(...e.starts),
      endsAt: at(...e.ends),
    });
    const patch: Record<string, unknown> = { description: e.description };
    if (e.refund) Object.assign(patch, { isRefundAvailable: true, refundPercent: e.refund.percent, refundCutoffHours: e.refund.cutoffHours });
    await sessions.organizer.ok(`event ${e.slug} details`, "PATCH", `/api/events/${created.id}`, patch);
    for (const ticket of e.tickets) {
      await sessions.organizer.ok(`ticket type ${e.slug}/${ticket.name}`, "POST", `/api/events/${created.id}/ticket-types`, ticket);
    }
    const state = e.state ?? "public";
    if (state === "public") await sessions.organizer.ok(`publish ${e.slug}`, "PATCH", `/api/events/${created.id}`, { status: "public" });
    if (state === "invite") {
      await sessions.organizer.ok(`event ${e.slug} invite-only`, "PATCH", `/api/events/${created.id}`, { status: "invite" });
      if (invites.length) await sessions.organizer.ok(`invitations ${e.slug}`, "POST", `/api/events/${created.id}/invitations`, { emails: invites });
    }
    if (state === "scheduled") {
      await sessions.organizer.ok(`schedule ${e.slug}`, "PATCH", `/api/events/${created.id}`, { status: "public", publishAt: at(e.publishInDays ?? 3, 9) });
    }
    console.log(`demo:   ${state.padEnd(9)} ${e.slug}`);
  }

  // 6. the credentials, for whoever presents (never committed: demo/.credentials is gitignored)
  const lines = [
    `# demo accounts of ${BASE}, seeded ${new Date().toISOString()}`,
    `DEMO_URL=${BASE}`,
    `DEMO_PASSWORD=${PASSWORD}`,
    ...Object.entries(accounts).map(([who, a]) => `DEMO_${who.toUpperCase()}_EMAIL=${a.email}`),
    "",
  ];
  writeFileSync(OUT, lines.join("\n"), { mode: 0o600 });
  chmodSync(OUT, 0o600);
  console.log(`demo: done. ${categories.length} categories, ${events.length} events, 3 accounts`);
  console.log(`demo: accounts (password in ${OUT}, mode 600):`);
  for (const [who, a] of Object.entries(accounts)) console.log(`demo:   ${who.padEnd(9)} ${a.email}`);
}

// exported for the unit test (demo/seed.test.ts), which checks the data without a running system
export { at, categories, email, events };

if (import.meta.main) {
  main().catch((error) => {
    console.error(`demo: FAILED. ${error instanceof Error ? error.message : error}`);
    if (created) {
      console.error("demo: the demo accounts exist now, so a re-run would skip and leave this demo partial: reset the database (or delete the demo users) and run again");
    }
    process.exit(1);
  });
}
