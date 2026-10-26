import { Elysia, t } from "elysia";
import { authGuard } from "@app/auth-guard";
import { outboxOverview } from "@app/db";
import { resumeNotifications, resumeTicketMails } from "@app/tickets";
import { heldRecords, resumePayment, resumeRefund } from "../../libs/reconcile";

const Params = t.Object({ id: t.String({ format: "uuid" }) });
// narrow a listing or a resume to one order (the default is everything held)
const Scope = t.Object({ enrollmentId: t.Optional(t.String({ format: "uuid" })) });

// What recovery gave up on (libs/reconcile.ts) and the way to let it try again, for admins: a paid order held because it would
// pass the ticket limit, an inconsistent row, a payment or refund whose attempts ran out, ticket mails that gave up. Ids and counts only.
export const recovery = new Elysia({ prefix: "/recovery" })
  .use(authGuard)
  .get("/held", { role: ["admin"], query: Scope }, ({ query }) => heldRecords(query))
  // the mail outboxes at a glance: counts per status (pending, leased, retry scheduled, failed, sent, skipped) and what isn't done
  // yet, by opaque id, kind, attempts, next attempt and error name; never a message or a recipient
  .get("/outbox", { role: ["admin"], query: Scope }, ({ query }) => outboxOverview(query))
  .post("/payments/:id/resume", { role: ["admin"], params: Params }, async ({ params }) => ({ resumed: await resumePayment(params.id) }))
  .post("/refunds/:id/resume", { role: ["admin"], params: Params }, async ({ params }) => ({ resumed: await resumeRefund(params.id) }))
  .post("/mails/resume", { role: ["admin"], query: Scope }, async ({ query }) => ({
    resumed: (await resumeTicketMails(query)) + (await resumeNotifications(query)),
  }));
