// Read-only check before a payment rollout or rollback (docs/tickets.md §10): `bun run preflight [--mode upgrade|rollback]` against DATABASE_URL.
// scripts/release.sh runs it as a one-off pod (the image's /app/preflight) and refuses to touch Helm unless its last line is a
// PREFLIGHT_RESULT with ok=true. Exit 0: nothing blocks; 1: something blocks; 2: it could not tell (the release then stops too).
//
// Blocking, in both modes: refund intents that are unresolved (an older payment version doesn't know them, and a Recreate rollout
// would stop the process that is finishing them mid-flight; let the scheduler finish them, or resolve them by hand).
// Blocking only for a rollback: mail still owed in either outbox (a version from before the outbox never sends it), and payments or
// refunds held for review (a version from before the holds would settle them).
// Everything else is reported for a person to read. It only SELECTs, and prints counts and ids, never a message, a connection
// string or a payment detail.
import { db, sql } from "@app/db";

const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "upgrade";
if (mode !== "upgrade" && mode !== "rollback") {
  console.error(`unknown --mode ${mode}`);
  process.exit(2);
}

type Row = Record<string, unknown>;
const rows = async (query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as Row[];
const count = async (query: ReturnType<typeof sql>) => Number((await rows(query))[0]?.n ?? 0);
const exists = async (query: ReturnType<typeof sql>) => (await rows(query)).length > 0;

try {
  // a database that hasn't been migrated to the schema this check reads has nothing the check is about (refund intents arrived with
  // migration 0013, the outboxes with 0012/0016): the first upgrade runs this before the migrate hook does
  const hasIntents = await exists(sql`select 1 from information_schema.columns where table_name = 'refunds' and column_name = 'recovery_hold'`);
  const hasHolds = await exists(sql`select 1 from information_schema.columns where table_name = 'payments' and column_name = 'recovery_hold'`);
  const hasTicketOutbox = await exists(sql`select to_regclass('ticket_mail_outbox') as t where to_regclass('ticket_mail_outbox') is not null`);
  const hasNotifications = await exists(sql`select to_regclass('notification_outbox') as t where to_regclass('notification_outbox') is not null`);

  const intents = hasIntents ? await count(sql`select count(*) as n from refunds where status = 'pending' and stripe_refund_id is null`) : 0;
  const heldPayments = hasHolds ? await count(sql`select count(*) as n from payments where recovery_hold is not null`) : 0;
  const heldRefunds = hasIntents ? await count(sql`select count(*) as n from refunds where recovery_hold is not null`) : 0;
  const stranded = await count(sql`
    select count(*) as n from payments p join enrollments e on e.id = p.enrollment_id
    where p.status = 'paid' and e.status in ('awaiting_payment', 'expired', 'cancelled', 'rejected')`);
  const notificationsOpen = hasNotifications ? await count(sql`select count(*) as n from notification_outbox where state in ('pending', 'failed') and kind <> 'epoch'`) : 0;
  const ticketMailsOpen = hasTicketOutbox ? await count(sql`select count(*) as n from ticket_mail_outbox where state in ('pending', 'failed')`) : 0;
  // the actual expression of payments_paid_at_check; every operand is non-null, so NOT (...) can't be NULL
  const violating = hasHolds
    ? await count(sql`select count(*) as n from payments where not (status not in ('paid', 'refunded') or paid_at is not null or recovery_hold is not null)`)
    : await count(sql`select count(*) as n from payments where status in ('paid', 'refunded') and paid_at is null`);
  const [constraint] = await rows(sql`select convalidated from pg_constraint where conname = 'payments_paid_at_check'`);
  const [migrations] = await rows(sql`select count(*) as n from drizzle.__drizzle_migrations`);

  const blocking: string[] = [];
  if (intents > 0) blocking.push("refund_intents_unresolved");
  if (mode === "rollback" && notificationsOpen + ticketMailsOpen > 0) blocking.push("mail_owed_that_an_older_version_never_sends");
  // a version from before the holds doesn't know recovery_hold: it would settle a payment held for the ticket limit
  if (mode === "rollback" && heldPayments + heldRefunds > 0) blocking.push("records_held_that_an_older_version_ignores");

  const lines: [string, number | string, string][] = [
    ["mode", mode, ""],
    ["schema has refund intents", String(hasIntents), hasIntents ? "" : "older than migration 0013: no intent can exist yet"],
    ["refund intents unresolved", intents, intents ? "BLOCKS: let the scheduler finish them, or resolve them by hand" : "ok"],
    ["payments held for review", heldPayments, heldPayments && mode === "rollback" ? "BLOCKS a rollback: an older version ignores holds (GET /api/payment/recovery/held)" : heldPayments ? "see GET /api/payment/recovery/held" : "ok"],
    ["refunds held for review", heldRefunds, heldRefunds && mode === "rollback" ? "BLOCKS a rollback: an older version ignores holds (GET /api/payment/recovery/held)" : heldRefunds ? "see GET /api/payment/recovery/held" : "ok"],
    ["paid payments on unconfirmed orders", stranded, stranded ? "the scheduler recovers these (or they are held)" : "ok"],
    ["notifications pending or failed", notificationsOpen, notificationsOpen && mode === "rollback" ? "BLOCKS a rollback: an older version never sends them" : notificationsOpen ? "see GET /api/payment/recovery/outbox" : "ok"],
    ["ticket mails pending or failed", ticketMailsOpen, ticketMailsOpen && mode === "rollback" ? "BLOCKS a rollback: an older version never sends them" : ticketMailsOpen ? "see GET /api/payment/recovery/outbox" : "ok"],
    ["rows violating payments_paid_at_check", violating, violating ? "resolve before VALIDATE CONSTRAINT (docs/tickets.md §10)" : "ok"],
    ["payments_paid_at_check validated", constraint ? String(constraint.convalidated) : "missing", constraint?.convalidated ? "ok" : !constraint ? "not created yet (migrations 0012-0015)" : violating ? "not yet: rows violate it" : "can be validated (scripts/check-paid-at-constraint.sh)"],
    ["migrations applied", String(migrations?.n ?? "?"), ""],
  ];
  for (const [name, value, note] of lines) console.log(`${name.padEnd(40)} ${String(value).padEnd(8)} ${note}`);

  // the line the release script reads; counts only
  console.log(
    `PREFLIGHT_RESULT ${JSON.stringify({
      ok: blocking.length === 0,
      mode,
      blocking,
      counts: { intents, heldPayments, heldRefunds, stranded, notificationsOpen, ticketMailsOpen, violating },
    })}`,
  );
  process.exit(blocking.length === 0 ? 0 : 1);
} catch (error) {
  // never the message: a driver error can carry the connection string
  console.error(`preflight could not read the database (${error instanceof Error ? error.name : "unknown"})`);
  process.exit(2);
}
