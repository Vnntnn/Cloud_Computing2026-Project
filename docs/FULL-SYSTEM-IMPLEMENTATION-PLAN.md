# Eventide Full-System V2 Checklist and Implementation Plan

  ## Summary

  Expand the current MVP into a staged, end-to-end ticket-commerce system derived from DB V1, with these locked decisions:

  - Preserve the existing auth, event, and registration services; add a payment service.
  - Use one db.t3.micro containing four isolated databases: auth_db, event_db, registration_db, and payment_db.
  - Reset existing demo data and regenerate clean baseline migrations and seed data.
  - Keep Better Auth as the sole owner of membership, credentials, sessions, OAuth, and JWKS.
  - Use one primary role: attendee, organizer, or admin. Organizers retain attendee permissions.
  - Payment is a mock: clicking “Pay now” immediately records a successful payment and confirms the order.
  - Do not implement waiting rooms, waitlists, Redis, message queues, or mail workers now. A full event returns 409 capacity_full.
  - Keep Vite SPA deployment; replace React Router with TanStack Router and adopt TanStack Query, TanStack Form, and official shadcn/ui.
  - Initialize shadcn with preset bfEjlVBAI: Luma, taupe/amber, Lucide, Geist Mono headings, Noto Sans, Radix base.

  Better Auth custom fields and plugin fields will be generated through its official schema mechanism, not hand-edited. The admin plugin supplies role and ban fields, while user.additionalFields
  supplies organizer/profile data. Better Auth database extensions (https://better-auth.com/docs/concepts/database), Better Auth admin plugin (https://better-auth.com/docs/plugins/admin).

  ## Target Data and Service Design

  ### Auth database

  Keep Better Auth-generated tables:

  - user
  - account
  - session
  - verification
  - jwks

  Extend user with:

  - phone
  - organizer_display_name
  - organizer_contact_email
  - organizer_contact_phone
  - organizer_approval_status: NOT_APPLIED | PENDING | APPROVED | REJECTED
  - organizer_approved_at
  - organizer_reject_reason

  Use the Better Auth admin plugin for:

  - role, defaulting to attendee
  - banned, ban_reason, and ban_expires
  - session.impersonated_by
  - Custom access-control roles for attendee, organizer, and admin

  Add application-owned tables:

  - login_attempts
  - user_audit_logs

  Do not recreate V1’s roles, user_roles, organizer_profiles, or auth_tokens. Their responsibilities are replaced by Better Auth fields, admin access control, and verification.

  JWT payloads must contain sub, email, role, and organizerApprovalStatus. Role or ban changes revoke existing sessions so stale authorization claims cannot survive.

  ### Event database

  Implement the V1 catalog domain:

  - categories
  - venues
  - events
  - ticket_types
  - event_images
  - event_change_logs

  Use text for every Better Auth user reference. Add database checks for positive quotas/prices, valid refund percentages, valid sales windows, and end_at > start_at.

  Lifecycle:

  DRAFT → PUBLISHED → CLOSED
              └────→ SUSPENDED by admin

  Only approved organizers may create or publish events. Owners may edit their own draft events; admin actions and organizer changes append to event_change_logs.

  ### Registration database

  Implement:

  - ticket_inventory
  - orders
  - order_items
  - order_audit_logs
  - tickets
  - check_ins
  - idempotency_keys

  Important invariants:

  - One order contains ticket types from one event.
  - Quantities and monetary totals are calculated server-side.
  - Inventory reservation uses one transaction and a per-ticket-type advisory lock.
  - reserved_count + sold_count <= total_quota.
  - Order holds expire after eight minutes.
  - Confirmation moves inventory from reserved to sold and emits one ticket row per purchased ticket.
  - Expiration or unpaid cancellation releases reserved inventory.
  - Refunding confirmed tickets releases sold inventory and marks tickets REFUNDED.
  - check_ins.ticket_id and event_id may be null for invalid QR attempts; store a hash of the submitted payload for auditing.
  - QR payloads are signed JWS values containing ticket ID, event ID, owner ID, issue time, and key ID.

  A separate registration expiry binary runs as a Kubernetes CronJob every minute with concurrencyPolicy: Forbid.

  ### Payment database

  Implement:

  - payments
  - payment_attempts
  - refunds

  The mock gateway accepts no card number, CVV, or billing credentials. It receives only an order ID and idempotency key, retrieves the trusted amount from Registration, creates a successful attempt,
  and confirms the order.

  If payment succeeds but Registration confirmation fails:

  - Set payment and order to PENDING_VERIFICATION.
  - Expose an idempotent reconciliation operation.
  - Retry from the UI or admin page; never charge twice.

  Keep gateway_webhooks for the real-product phase because the mock gateway produces no webhooks.

  ## Public APIs and Data Flow

  ### Auth and membership

  - Preserve Better Auth endpoints under /api/auth/*.
  - GET/PATCH /api/users/me
  - POST /api/users/me/organizer-application
  - GET /api/admin/users
  - POST /api/admin/organizers/:userId/approve
  - POST /api/admin/organizers/:userId/reject
  - POST /api/admin/users/:userId/ban
  - POST /api/admin/users/:userId/unban

  Custom admin routes wrap Better Auth admin operations so every privileged action is audited.

  ### Catalog

  - GET /api/categories
  - GET /api/venues
  - GET /api/events with validated search, category, province, date, status, page, and page-size parameters
  - GET /api/events/:id
  - GET /api/events/:id/ticket-types
  - POST/PATCH /api/events
  - POST /api/events/:id/publish
  - POST /api/events/:id/close
  - POST/PATCH /api/ticket-types
  - Event-image presign, reorder, and delete endpoints
  - Admin event-suspension endpoint

  List responses use { items, total, page, pageSize }; monetary values are decimal strings and timestamps are ISO-8601.

  ### Orders, payments, and tickets

  - POST /api/orders with Idempotency-Key
  - GET /api/orders/me
  - GET /api/orders/:id
  - POST /api/orders/:id/cancel
  - POST /api/payments/checkout with Idempotency-Key
  - GET /api/payments/order/:orderId
  - POST /api/payments/:id/reconcile
  - GET /api/tickets/me
  - GET /api/tickets/:id
  - POST /api/check-ins
  - GET /api/check-ins/events/:id (kept under the /api/check-ins prefix so a single ingress rule routes it to registration, not event)

  Service-to-service endpoints use X-Eventide-Internal-Token, are not exposed through ingress, and compare the token in constant time. Payment never trusts an amount supplied by the browser.

  All Elysia request and response schemas use t/TypeBox, remain in unbroken method chains, and continue exporting Eden Treaty application types.

  ## Implementation Status — 2026-09-08

  Legend: `[x]` done · `[~]` partial (note explains the gap) · `[ ]` not started.

  Milestones 0–5 are complete on `main`. `bun run lint / check-types / test / build` all pass;
  the backend transaction & authorization matrix is now automated (oversell,
  idempotency, hold expiry, payment reconciliation, QR scans, membership/ban)
  and CI runs it against a real Postgres plus a `scripts/smoke.ts` persona
  `e2e` job. Not yet done: doc updates (M0/M7 — SYSTEM-DESIGN, decision log,
  TODO, REPORT, DEMO-RUNSHEET still describe the 3-service MVP), k3d/EKS
  rehearsals, broader frontend regression tests, richer attendee refund status,
  and refund-failure reconciliation controls.

  ## Staged Implementation Checklist

  ### Milestone 0 — Baseline and schema reset

  - [x] Pin Better Auth runtime packages to 1.7.3; invoke the current official CLI explicitly and add a generated-schema drift check. `apps/auth` runtime `better-auth`/`@better-auth/drizzle-adapter` = 1.7.3; `generate:auth-schema` + `check:auth-schema` (drift) scripts added; the stale 1.4.21 CLI dependency was removed.
  - [x] Replace active V1 DBML and DrawIO documents with the corrected V2 architecture; retain V1 through Git history. `database/schema/DBML/ER_Diagram.dbml` + `DrawIO/brief_er.drawio` rewritten to `Eventide_V2` (4 logical DBs, identifier-only cross-DB refs).
  - [x] Regenerate clean 0000 migrations for all four databases. New `0000_*` for auth/event/registration/payment; old ones deleted. `make bootstrap` applies all four clean.
  - [x] Add payment_svc role/database to bootstrap, Terraform credentials, Docker builds, and deployment scripts. `bootstrap.ts`, `10-foundation` (`var.services` incl. `payment`), `20-platform/rds.tf`, `deploy.sh`, `apps/payment/Dockerfile`.
  - [x] Add a deliberate local database-reset target and document that no production data is preserved. `make db-reset` (`docker compose down -v` + bootstrap).
  - [ ] Update the system design and decision log to record the expanded scope and increased pod/resource requirements. **Not done** — `docs/SYSTEM-DESIGN.md`, `docs/PROJECT-KNOWLEDGE-BASE.md`, `docs/TODO.md` still describe the 3-service MVP.

  ### Milestone 1 — Better Auth membership and authorization

  - [x] Configure the admin plugin, custom roles, additional user fields, database rate limiting, and JWT claims. `apps/auth/src/lib/auth.ts`: admin plugin + `createAccessControl` (attendee/organizer/admin), `user.additionalFields` (phone + organizer/*), `rateLimit` storage `database` (gated to `NODE_ENV==='production'` so `db:seed` works), JWT claims sub/email/role/organizerApprovalStatus.
  - [x] Generate the Better Auth schema; never edit generated schema manually. `packages/db/src/auth/schema.ts` is CLI-generated; app-owned tables kept separate in `auth/app-schema.ts` (`login_attempts`, `user_audit_logs`).
  - [x] Add organizer application, approval, rejection, ban, and audit endpoints. `/api/users/me/organizer-application`, `/api/admin/organizers/:id/{approve,reject}`, `/api/admin/users/:id/{ban,unban}`, `/api/admin/users`, `/api/admin/audit-logs`.
  - [x] Extend the shared JWT guard with validated typed claims and reusable role/permission guards. `packages/shared/src/auth/bearer.ts` (`AuthUser` typed claims) + `internalTokenMatches` (constant-time) in `auth/internal.ts`.
  - [x] Update seed logic with one admin, approved/pending organizers, attendees, and banned-user coverage. `packages/db/scripts/seed.ts` PEOPLE list covers all five.

  ### Milestone 2 — Event catalog

  - [x] Add category, venue, event, ticket-type, image, and change-log schemas. `packages/db/src/event/schema.ts`: categories, venues, events, ticket_types, event_images, event_change_logs + CHECK constraints (positive quota/price, valid windows, `ends_at > starts_at`).
  - [x] Implement public filtering/pagination and organizer-owned CRUD. `GET /api/events` (search/category/province/date/status/page/pageSize), `/api/organizer/events`, `POST|PATCH /api/events`, `/api/ticket-types`.
  - [x] Implement draft, publish, close, and admin-suspend transitions. `/api/events/:id/{publish,close}`, `/api/admin/events/:id/suspend`.
  - [x] Preserve direct-to-S3 uploads; expand from one cover key to ordered event images. The organizer manager supports up to eight images with append uploads, cover ordering, and deletion through `/api/events/:id/images/{presign,reorder,:imageId}`; public/detail/dashboard thumbnails use the first image.
  - [x] Add checkout summaries and quota-validation internal endpoints. `/internal/events/:id/checkout-summary` (token-guarded).

  ### Milestone 3 — Inventory and orders

  - [x] Add inventory, order, item, audit, and idempotency schemas. `ticket_inventory, orders, order_items, order_audit_logs, tickets, check_ins, idempotency_keys` + `inventory_within_quota` CHECK.
  - [x] Implement atomic reservations and concurrent oversell protection. One transaction + `pg_advisory_xact_lock(hashtextextended(ticketTypeId))` per ticket type.
  - [x] Enforce ticket sales windows, per-user limits, one-event-per-order, and server-calculated totals. `maxPerOrder` and cumulative `maxPerUser` are enforced under the ticket-type advisory lock; cancelled, expired, and refunded orders release the attendee allowance.
  - [x] Implement eight-minute holds and the expiry CronJob. `expiresAt = now + 8min`; `apps/registration/src/expire.ts` (now exits explicitly) run by `infra/helm/eventide/templates/registration-expiry-cronjob.yaml` (`* * * * *`, `concurrencyPolicy: Forbid`). Expiry verified locally.
  - [x] Return 409 capacity_full when inventory is exhausted; do not expose a queue action. `CapacityFull` → 409, no queue path.

  ### Milestone 4 — Mock payment, tickets, refunds, and check-in

  - [x] Create the payment service, mock gateway adapter, payment attempts, and reconciliation state machine. `apps/payment` (port 3003, `payment_db`): `payments, payment_attempts, refunds`; `/api/payments/{checkout,order/:id,:id/reconcile,order/:orderId/refund,admin}`.
  - [x] Confirm orders idempotently and generate one signed ticket per quantity. Idempotency-Key on checkout; `/internal/orders/:id/confirm` issues one signed (JWS) ticket per unit.
  - [x] Implement pending-order cancellation and confirmed-order mock refunds. `POST /api/orders/:id/cancel`; `/internal/orders/:id/refund` releases sold inventory, marks tickets REFUNDED.
  - [x] Add QR retrieval and organizer/admin check-in APIs. `GET /api/tickets/:id` (qrToken), `POST /api/check-ins`, `GET /api/check-ins/events/:id` (moved from `/api/events/:id/check-ins` to avoid the event-service ingress prefix collision).
  - [x] Record successful, duplicate, cancelled, wrong-event, and invalid-signature scans. `check_ins.result` ∈ {SUCCESS, DUPLICATE, WRONG_EVENT, …}; payload hash stored; ticket_id/event_id nullable for invalid QR.
  - [~] Add manual retry/reconciliation controls for uncertain payment/refund states. Payment reconciliation is available in the admin UI through `/api/payments/:id/reconcile`; **failed-refund reconciliation still has no dedicated operation.**

  ### Milestone 5 — Frontend foundation

  - [x] Remove react-router-dom; add TanStack Router v1, Query v5, Form v1, and the Vite router plugin. `react-router-dom` gone; `@tanstack/{react-router,react-query,react-form}` + `@tanstack/router-plugin` added.
  - [x] Use file-based routing with automatic code splitting; configure the router plugin before React and exclude generated routeTree.gen.ts from Biome. `vite.config.ts` plugin order `tanstackRouter(...) , react()`, `autoCodeSplitting: true`; `biome.json` `!apps/web/src/routeTree.gen.ts`.
  - [~] Create one QueryClient in router context and use route loaders with ensureQueryData; use stable query-option factories and targeted mutation invalidation. QueryClient in router context + `lib/queries.ts` option factories present; **loader `ensureQueryData` prefetch used on some routes, not all**.
  - [x] Initialize official shadcn/ui with preset bfEjlVBAI, merge the current button/card/input implementations, and add Field, Select, Textarea, Table, Badge, Dialog, AlertDialog, Sheet, Tabs, Skeleton, Empty, Spinner, Progress, Sonner, and navigation components. `apps/web/components.json` + all listed components under `src/components/ui/`.
  - [x] Build forms with TanStack Form plus shadcn FieldGroup, Field, FieldError, data-invalid, and aria-invalid. Login + event-editor + organizer-application forms.
  - [x] Keep Eden clients inside query/mutation functions so backend response types remain inferred. Eden Treaty calls live in `lib/queries.ts` / route mutation fns.

  ### Milestone 6 — Frontend product flows

  - [x] Public: searchable event listing, filters, event detail, ticket-type quantities, and sold-out state. `routes/index.tsx`, `routes/events.$eventId.tsx`.
  - [x] Authenticated attendee: profile, checkout, eight-minute countdown, mock Pay button, order history, tickets, QR view, cancellation, and refund status. Tickets render scannable QR codes; order cards explain pending verification, cancellation, expiry, and completed refunds without exposing the signed token.
  - [x] Organizer: application/status, dashboard, event editor, ticket types, ordered image manager, sales summary, and camera/manual check-in. The scanner loads the camera decoder only when activated and retains manual entry.
  - [x] Admin: user management, organizer approvals, event moderation, membership audit view, payment reconciliation, and camera/manual check-in screens.
  - [x] Implement pathless authenticated, organizer, and admin layouts with TanStack Router beforeLoad guards. `_authenticated.tsx`, `_organizer.tsx`, `_admin.tsx` with `beforeLoad`.
  - [x] Route-code-split admin pages and defer heavy scanner/QR code. TanStack auto code-splitting isolates route code; the ZXing camera decoder is dynamically imported only when scanning starts, and QR rendering ships only with the tickets route.

  ### Milestone 7 — Deployment, seed, and documentation

  - [x] Add payment ECR repository, Dockerfile, Kubernetes Service/Deployment, secret, ingress route, and health probes. Helm chart renders 5 Deployments/Services + payment ingress `/api/payments`; `apps/payment/Dockerfile`; ECR repo via `10-foundation`.
  - [x] Add internal-service and ticket-signing secrets to local and AWS deployment paths. `INTERNAL_SERVICE_TOKEN` (all services), `TICKET_SIGNING_SECRET`/`_KEY_ID` (registration) — local defaults + `deploy.sh` injection.
  - [x] Run payment and web with one replica on normal t3.small sessions; retain two replicas for auth/event/registration. `values.yaml` `defaults.replicas: 2`; `payment`/`web` override to `1`.
  - [~] Extend seed data with categories, venues, ticket types, inventories, event states, orders, payments, refunds, tickets, and check-ins. Users, 1 category, 1 venue, 12 events (1 DRAFT), ticket types, 2 orders + payments + tickets, inventory (auto). **No refunds, no check-ins, single category/venue.**
  - [~] Update make dev, k3d, Helm, EKS deploy, teardown, report, and demo runbook. `make dev`/`bootstrap`/`db-reset`, Helm, `deploy.sh` updated. **`docs/REPORT.md` + `docs/DEMO-RUNSHEET.md` not updated; k3d script not re-checked for the 4th service.**
  - [ ] Complete one clean local reset, one k3d rebuild, and one EKS destroy/rebuild rehearsal. Local clean reset done. **k3d + EKS rehearsals not run (need a lab session).**

  ## Test and Acceptance Plan

  CI (`.github/workflows/ci.yml`) now runs the `check` job against a real
  Postgres and a second `e2e` job that boots the four services and runs
  `scripts/smoke.ts` (`make smoke`). Component tests use `@eventide/shared/testing`
  (a `test.preload` JWKS fixture so the real `bearerAuth` guard runs, plus HTTP
  stubs for in-cluster peers).

  - [x] Schema tests verify ID types, foreign keys inside each database, absence of cross-database FKs, checks, indexes, and unique constraints. `packages/db/src/schema.test.ts` — text ids across boundaries, zero cross-DB FKs, every named CHECK + unique.
  - [~] Better Auth tests cover email/password, Google OAuth configuration, role claims, organizer approval, ban enforcement, session revocation, and audit logs. `apps/auth/test/membership.test.ts` covers all of these **except Google OAuth config** (no creds in CI).
  - [x] Parallel order tests prove the final ticket cannot be oversold. `orders.oversell.test.ts` — `QUOTA+6` concurrent orders, exactly `QUOTA` succeed.
  - [~] Repeated requests with one idempotency key produce one order, one payment, and one set of tickets. Order side: `orders.idempotency.test.ts` (3 concurrent → one order/one item set). Payment side: `checkout.test.ts` (one payment/one attempt). Not asserted as a single cross-service chain outside the smoke.
  - [x] Expired holds release inventory; paid holds cannot expire. `orders.idempotency.test.ts` › "hold expiry".
  - [x] Payment confirmation failure produces PENDING_VERIFICATION and reconciliation completes without double payment. `checkout.test.ts` › "goes PENDING_VERIFICATION … then reconciles once".
  - [x] Refunds cancel the correct tickets and restore inventory once. `refund.test.ts` confirms a repeated refund restores each inventory row once, marks every ticket REFUNDED, and writes one audit entry.
  - [x] QR tests cover valid, tampered, duplicate, cancelled, and wrong-event scans. `checkin.test.ts` (5 outcomes + payload hash + one row per scan).
  - [~] Frontend tests cover route guards, validated search parameters, loading/error/empty states, form errors, query invalidation, and retry behavior. Route-access decisions, search coercion, thumbnails, QR rendering, and direct-upload success/failure have Bun coverage; **route-level loading/error states, form errors, invalidation, and retry behavior still need focused tests.**
  - [x] E2E personas cover attendee purchase, organizer approval/event publication/check-in, and admin moderation. `scripts/smoke.ts` (CI `e2e` job) — 27 assertions.
  - [x] A sold-out event returns 409 and exposes no queue action. `scripts/smoke.ts` + `orders.oversell.test.ts`. (The "Sold out" label is Phase 4 frontend.)
  - [x] bun run lint, bun run check-types, bun run test, and bun run build pass.
  - [x] Liveness endpoints remain database-free; readiness checks only the service’s own database. `/health/live` returns a static payload; `/health/ready` checks the service DB.

  ## Deferred Real-Product Checklist

  - [ ] Add waiting_room_entries and waitlists.
  - [ ] Introduce Valkey/ElastiCache for admission tokens and peak-load filtering.
  - [ ] Add order/ticket transactional outboxes.
  - [ ] Publish domain events through EventBridge/SQS with retries and dead-letter queues.
  - [ ] Add a mail worker for verification, password reset, purchase, refund, and ticket messages.
  - [ ] Replace the mock gateway with a real sandbox/production provider.
  - [ ] Add signed webhook ingestion, gateway_webhooks, automated reconciliation, and chargeback handling.
  - [ ] Move payment and high-write booking workloads to separate Multi-AZ RDS instances; add read replicas only after measured need.
  - [ ] Perform a formal PCI scope review before accepting any real card workflow.

  ## Assumptions

  - Existing local and ephemeral RDS records may be discarded.
  - Current service and database names remain event/event_db and registration/registration_db, rather than renaming them to catalog/booking.
  - The application remains a client-rendered Vite SPA; TanStack Start and SSR are out of scope.
  - Email verification fields remain supported by Better Auth, but real email delivery is deferred with the mail worker.
  - The mock payment screen never collects or displays card fields.
  - All dates are stored as timestamptz, sent as ISO-8601, and displayed in Asia/Bangkok.
  - THB is the initial currency; APIs represent money as decimal strings rather than JavaScript floating-point values.
