# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Eventide: an event ticketing website built as a Bun-workspace monorepo of microservices. Stack: React + TanStack Router (web), ElysiaJS (services), Drizzle + Postgres (data), S3 (files). User-facing copy is in Thai.

### Roles

- **user**: enroll in a ticket, view own tickets, manage own profile, apply to become an organizer
- **organizer**: create events, ticket types and enrollment forms; add team members; check in tickets; view the event dashboard; manage **only their own** events
- **admin**: manage all events, suspend accounts, manage other accounts, approve organizer applications (user → organizer)

### Auth and email

- **Auth:** `apps/auth` runs Better Auth (load the `better-auth-*` skills before changing it).
  - Login is email/password, plus Google, which is enabled only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (`GET /api/auth/providers` tells the web).
    - Account linking keeps Better Auth's defaults: Google is merged into an existing account only if that account's email is verified. Email verification isn't set up, so password users get `account_not_linked` and link Google from `/profile` instead.
  - The admin plugin stores the role (`user` / `organizer` / `admin`, defined in `packages/auth-guard/src/permissions.ts` together with the domain permission statements) on `users.role`. Suspending an account is the admin plugin's **ban**.
  - Organizer applications live in `apps/auth` (`/api/auth/organizer-applications`, table `organizer_applications`). Approving one sets the role in a transaction.
  - `GET /api/auth/organizers/:id` is the public organizer profile the event page shows (organization name from the approved application, avatar, approval date). It never returns the email or the application's contact/reason, and answers 404 for plain users.
  - Deleting an account (self-delete or the admin plugin's remove-user) is refused with `ORGANIZER_HAS_EVENTS` while the user organizes events. `events.organizer_id` is `ON DELETE RESTRICT`, and Better Auth deletes a user's sessions and accounts before the user row, so the check has to run before Better Auth starts.
  - Bootstrap the first admin with `cd apps/auth && bun run admin:promote <email>` after registering in the web (on a cluster: `make admin EMAIL=<email>`).
- **Service auth:** only `apps/auth` touches the auth tables and holds `BETTER_AUTH_SECRET`. Every other service does `.use(authGuard)` from `@app/auth-guard`.
  - On each request the guard forwards the cookie to `AUTH_SERVICE_URL/api/auth/get-session` and caches the answer in Redis for 60s.
  - `databaseHooks` in `apps/auth/src/libs/auth.ts` write a revoked marker on ban, role change and sign-out, so those apply on the next request. Anything else that changes a role or deletes sessions outside Better Auth must call `markUserRevoked()`.
  - Design, diagrams and failure modes: `docs/auth.md`.
- **Email:** nothing sends mail inline. Producers call `enqueueMail({ to, template, props })` from `@app/mail`, which puts a message on the SQS `mail-queue`. `apps/mail-worker` consumes the queue, renders the template and sends with **Nodemailer over Gmail SMTP**.
  - Producers send data, never HTML. Each template's props are typed in `packages/mail/src/templates.ts`: raw strings (React escapes them), dates as ISO strings and amounts in baht. The subject, the wording and all formatting live in the template.
  - Templates are **React Email** (`react-email`) in `apps/mail-worker/emails/<template>.tsx`. Each one default-exports the component with `PreviewProps` and exports `subject(props)`. They share `MailLayout` and the blocks in `emails/_components/` (`EventDetails`, `CtaButton`, `Note`, `RefundOutcome`, …).
  - The Tailwind theme (`_components/theme.ts`) copies the web's tokens under the same names, in hex because mail clients don't read oklch. Use px values, not rem.
  - `src/render.tsx` registers every template, renders HTML plus a plain-text part and attaches the logo inline (`cid:logo@eventide`, from `emails/static/logo.png`).
  - Adding a mail means adding its props to `MailTemplates`, adding `emails/<name>.tsx` and adding a registry entry; a missing entry is a type error.
  - Preview: `bun run --filter @app/mail-worker preview` (http://localhost:3010).
  - A message is deleted only after it sends. Failures are retried and land in `mail-dlq` after 5 receives. That includes a template that throws on its props, so a fixed template can redrive them. A message with an unknown template is logged and left to reach the DLQ the same way.
  - Without `GMAIL_USER` / `GMAIL_APP_PASSWORD`, the worker runs dry and logs each mail's recipient, subject and plain text instead of sending it.

## Commands

Use Bun for everything: `bun install`, `bun run <script>`, `bunx <pkg>`, `bun test`. Run these from the repo root unless noted.

```sh
cp .env.example .env          # one-time; every workspace reads the ROOT .env
bun run infra:up              # start docker-compose services (infra:down to stop, infra:reset wipes volumes)
bun run dev                   # every apps/* dev script in parallel (web, all services, mail worker)
bun run --filter @app/event dev   # one workspace only

bun run db:generate           # generate SQL migration from schema changes -> packages/db/drizzle/
bun run db:migrate            # apply migrations
bun run db:studio             # Drizzle Studio

bun run --filter @app/web lint    # oxlint (web only, no lint config elsewhere)
bun run --filter @app/web build   # tsc -b && vite build
bun run --filter @app/web start   # production server for the built web (dist/ + per-URL Open Graph tags)
bun run --filter @app/mail-worker preview   # React Email preview of every mail template on :3010
```

**Type checking:** run `bun check` from **inside** a workspace (`cd apps/web && bun check`; `cd apps/event && bun check src/index.ts`). The root `bun run typecheck` reads the root tsconfig, which has no DOM lib and no `@/*` alias, so it reports false errors in `apps/web`.

**Tests:** use `bun test` (`import { test, expect } from "bun:test"`). Suites that need env or infra get a `test` script that passes `--env-file=../../.env`; run them with `bun run test` inside `packages/auth-guard`, `packages/storage`, `apps/auth`, `apps/event`, `apps/registration` or `apps/payment` (they need `infra:up`). `apps/mail-worker` also has a `test` script, which renders every template and needs no infra. The `test` scripts of `apps/event`, `apps/registration` and `apps/payment` run each file in its own process, because the auth mock (`mock.module`) leaks between files. For a single file use `bun test test/event.test.ts`, and for a single test use `bun test -t "pattern"`.

**shadcn CLI:** `components.json` lives in `apps/web`, so run `cd apps/web && bunx shadcn@latest add <component>`. The shadcn MCP server is configured in `.mcp.json`.

## Local infrastructure (`docker-compose.yml`)

| Service | Port(s) | Notes |
|---|---|---|
| Postgres 18 | 5432 | `DATABASE_URL` |
| Redis 8 | 6379 | `REDIS_URL` (the default env var for Bun's `redis` client) |
| ElasticMQ (SQS) | 9324 API, 9325 UI | queues defined in `infra/elasticmq/elasticmq.conf` |
| MinIO (S3) | 9000 API, 9001 console | `minio-init` creates the `event-assets` bucket |

- **Queues:** `mail-queue` has a 30s visibility timeout and a 10s long poll. After 5 receives a message moves to `mail-dlq`. A new queue must be added to `elasticmq.conf` and get its URL variable in `.env.example`.
- **S3:** the `S3_*` variables in `.env.example` are the ones Bun's built-in `s3` client reads by default, so `import { s3 } from "bun"` works without config. `minio-init` also sets a bucket policy that lets anyone read `public/*`; every other prefix stays private. In dev the Vite server proxies `/files/<key>` to the bucket.
- **Env loading:** workspace scripts run from the package directory, so each one passes `--env-file=../../.env`. Keep doing that in new packages.

## Architecture

### Workspaces

- `apps/web` (`@app/web`): Vite + React 19 SPA on :5173. Uses TanStack Router (file-based), TanStack Query and shadcn/ui. `server/` holds its production server and the per-URL `<head>` (see **Link previews** below).
- One Elysia service per domain, each with its own process, port and path prefix:

  | Workspace | Port | Prefix | Owns |
  |---|---|---|---|
  | `apps/auth` | 3001 | `/api/auth` | Better Auth: accounts, sessions, roles, bans |
  | `apps/event` | 3002 | `/api/events` | events (CRUD, slug, status, refund policy, HTML description, a Redis cache of the detail, Open Graph images), categories (admin-only), cover + gallery, invitations (who may open an `invite`-status event, by email), ticket types and their registration forms (`ticket_types`, `ticket_type_questions`) |
  | `apps/registration` | 3003 | `/api/regis` | seat availability (plus a live WebSocket feed), enrollments (enroll, approve / reject), tickets ("my tickets"), check-in |
  | `apps/payment` | 3004 | `/api/payment` | Stripe Checkout for enrollments, the Stripe webhook, refunds (`payments`, `refunds`) |

- `apps/mail-worker`: an SQS consumer with no HTTP server. It renders queued mail with the React Email templates in `emails/` and sends it through Gmail. It is the only workspace that depends on React besides the web.
- `packages/db` (`@app/db`): the Drizzle schema and client that every service shares.
- `packages/auth-guard` (`@app/auth-guard`): roles and permissions (`./permissions`, browser-safe, also used by the web), the session introspection + Redis cache, and the `authGuard` Elysia plugin.
- `packages/mail` (`@app/mail`): the mail queue contract. It holds the `MailMessage` / `MailContent` types (a template name plus its props, from `src/templates.ts`), the shared `sqs` client, `enqueueMail()` for producers and `parseMailMessage()` for the worker.
- `packages/storage` (`@app/storage`): file storage that each service imports (a library, not a service), built on [files-sdk](https://files-sdk.dev) over Bun's S3 client. See **Files** below.
- `packages/tickets` (`@app/tickets`): ticket issuing shared by registration and payment (a library): which enrollments hold seats, confirming one, mailing its tickets, announcing seat changes. See **Tickets** below.
- `services/*` is declared as a workspace glob but is unused. Root `bun run dev` only starts `apps/*`.

The generic Bun advice doesn't fully apply here. The web app **does** use Vite (not Bun HTML imports), and the DB layer uses Drizzle on the **postgres.js** driver (not `Bun.sql`). Elsewhere in services, prefer Bun built-ins (`Bun.redis`, `s3`, `Bun.file`, `Bun.$`).

### How web talks to services (end-to-end type safety)

1. Each service's root Elysia instance owns a path prefix: `new Elysia({ prefix: "/api/events" })`.
2. In dev, the Vite server proxies that same prefix to the service port (`server.proxy` in `vite.config.ts`).
3. The service package's `main` exports its app type (`export type Event = typeof event`).
4. `apps/web` lists the service as a `workspace:*` **devDependency** and builds an Eden Treaty client in `src/lib/api.ts`: `treaty<App>(window.location.origin)`.
5. Calls mirror the full path, e.g. `eventClient.api.events.health.get()`. They return `{ data, error }`, so throw `error` inside the `queryFn` so that TanStack Query sees the failure.

Adding a service means touching all of these. Create `apps/<name>/package.json` with the dev script `PORT=<port> bun --env-file=../../.env --watch src/index.ts` and a dependency on `@app/db`. Add a prefixed root instance with its type exported, a proxy entry in `vite.config.ts`, the web devDependency, and a treaty client in `api.ts`. Also add its health check to `src/routes/status.tsx` (`/status`), the page that shows the status of every service.

**Better Auth mounting:** don't use `.mount(auth.handler)` inside the prefixed instance. `.mount()` strips the prefix, so Better Auth, which routes on the full `/api/auth/*` path, returns 404. `apps/auth/src/index.ts` forwards the request untouched with `.all('/*', { parse: 'none' }, ({ request }) => auth.handler(request))`. Better Auth's `baseURL` (`BETTER_AUTH_URL`) is the browser-facing origin, i.e. the Vite server in dev, not port 3001.

### Backend: Elysia 2

The services are on `elysia@^2.0.0-rc`, whose APIs differ from v1. Load the `elysiajs` skill or the docs instead of relying on memory. Follow https://next.elysiajs.com/essential/best-practice/. Target layout per service (`apps/event`, `apps/registration` and `apps/payment` follow it, e.g. `apps/event/src/routes/{events,categories,media,invitations,ticket-types}`):

```
src/
  index.ts             import app, export it, call .listen()
  app.ts               compose features with .use(); export app + App type; never listens
  env.ts               validated env
  routes/<feature>/
    index.ts           controller: Elysia instance; owns status codes, headers, cookies, redirects
    model.ts           request/response schemas + derived types
    service.ts         plain functions with explicit args; may query db directly
  plugins/             shared, *named* plugins (new Elysia({ name })), e.g. auth/role macros
  libs/                shared non-Elysia clients/helpers (only once a second feature needs them)
test/<feature>.test.ts
```

- **Models:** export one object per route named `[Pathname][Method]` relative to the prefix (`Post`, `ByIdGet`). It holds PascalCase `Body` / `Params` / `Query` / `Response` schemas, plus a matching `UnwrapModels<typeof X>` type. Import it as a namespace: `import * as EventModel from "./model"`. Models are the API contract, not DB tables, so never expose sensitive columns when deriving them from Drizzle.
- **Services:** never pass the request context or cookies. Pass only the values the service needs.
- **Errors:** return errors rather than throwing them, so Eden and OpenAPI can infer them. When the same error is used in several places, make it a class extending `HTTPError.id("CODE", status)`.
- **Dependencies:** use `decorate` for app-lifetime singletons and `derive` for per-request values. Release decorated resources in `onStop`.
- **Authorization:** `.use(authGuard)` gives the route options `{ auth: true }`, `{ role: ["organizer", "admin"] }` and `{ permission: { event: ["create"] } }`, each adding `user` / `session` to the context. Put ownership checks (organizers may only touch their own events) in a named plugin or macro in `plugins/`, never ad hoc in handlers. `apps/event/src/plugins/event-owner.ts` (`{ eventOwner: true }`, which adds `event`) is the example. A macro can't read another macro's derives, so such a macro calls `authenticate()` from `@app/auth-guard` itself.
- **Testing:** test services directly, and test controllers through `app.handle()` or `treaty(app)`.

### Database: `@app/db`

- Put one schema file per domain in `packages/db/src/schema/` and re-export it from `schema/index.ts`. `drizzle.config.ts` reads the whole directory.
- Every table spreads `id()` (uuid, `defaultRandom`) and `...timestamps` (`created_at` / `updated_at` with `$onUpdate`) from `_columns.ts`. Use snake_case SQL column names and camelCase TS keys.
- Services import `db`, the tables and the query operators (`eq`, `and`, `sql`, …) from `@app/db`. If you need a new operator, add it to the re-export list in `packages/db/src/index.ts` instead of adding `drizzle-orm` to a service.
- Store S3 object **keys**, not URLs (e.g. `events.coverImageKey`). `users.image` is the one exception; see **Files** below.
- `schema/auth.ts` holds the Better Auth tables (`users`, `sessions`, `accounts`, `verifications`). They are plural (`usePlural: true`) with uuid ids (`generateId: "uuid"`), so other tables can reference `users.id` as a `uuid`.
  - The shape must match what Better Auth expects; it validates the Drizzle schema at startup and logs mismatches.
  - After adding a Better Auth plugin, run `cd apps/auth && bunx auth@latest generate --config src/libs/auth.ts --output <scratch file> --yes`, merge the diff into `auth.ts` using the `_columns.ts` helpers, then run the migration flow.
- Stripe access goes through the client in `apps/payment/src/libs/stripe.ts`. Live keys (`sk_live_` / `rk_live_`) are refused outside production.
- Migration flow: edit the schema → `bun run db:generate` → review the SQL in `packages/db/drizzle/` → `bun run db:migrate`.

### Files: `@app/storage`

- **Uploads go through the owning service** as multipart. The route body is `{ file: t.File() }`, and the service calls `storeFile(kind, ownerId, file)`.
  - It sniffs the bytes (files-sdk `contentType()`), then checks the kind's types and size (`validation()`).
  - It **returns** `UnsupportedFile` (415), `FileTooLarge` (413) or `StorageUnavailable` (503) with Thai `detail`s.
  - Don't put `type` on `t.File`: Elysia 2 would need a file-type detector, and its 422 isn't in Thai.
- **Kinds** live in `packages/storage/src/kinds.ts` (`avatar`, `eventCover`, `eventAsset`), so add new ones there.
  - Keys are `public/<users|events>/<ownerId>/<folder>/<uuidv7>`.
  - Keys have no extension, because the stored Content-Type comes from the bytes.
- **Store the key** in the DB (`events.coverImageKey`, `event_assets.key`) and send `fileUrl(key)` (`/files/<key>`) in responses, so the web never imports `@app/storage`.
  - The exception is `users.image`, which holds the `/files/<key>` path, because Better Auth owns that field and Google writes URLs into it.
  - `ownedKey(url, kind, ownerId)` gives the key back only when the URL is that owner's own file, so a Google photo or a path the user set by hand is never deleted.
- **Replace, then delete:** commit the new key (lock the row when replacing), then `deleteFile(old)`. It is best effort and never throws, so a failure leaves an orphaned object rather than a failed request.
- **Tests:** `useMemoryStorage()` from `@app/storage/testing` swaps in files-sdk's in-memory adapter and returns it for assertions.
- **Not used on purpose:** files-sdk's `files-sdk/api` gateway and its React upload components. They would move authorization and the DB write out of the service's request and lose the Eden types.
- Design, diagrams and failure modes: `docs/storage.md`.

### Tickets: `@app/tickets`

- **Ticket types** (`apps/event`) have a kind: `first_come` (needs a `quota`), `approval` (the organizer approves each enrollment, no quota) or `invite` (only emails in `event_invitations`, one enrollment per invitation). Prices are whole baht; 0 is free, a paid price is at least ฿20 (Stripe's minimum). `maxPerUser` counts across all of an account's enrollments of that type.
  - Each type has its own questions (`ticket_type_questions`: short text, long text, choice), saved as one list that replaces the old one. First name, last name and email are on every ticket and are not questions.
  - The web pre-fills ticket 1 from `users.firstName` / `lastName` (Better Auth `additionalFields`, editable on `/profile`, filled from Google).
- **An enrollment** (`apps/registration`) is one order: `quantity` tickets with one attendee each (`tickets`: name, lowercase email, `answers` copied with their labels).
  - Statuses: `pending` (approval) → `awaiting_payment` (paid) → `confirmed`, or `rejected` / `expired`.
  - **Active** = `confirmed`, `pending`, or `awaiting_payment` whose `expires_at` is ahead (`activeEnrollment()`). A lapsed hold stops counting at once, with no job; reads show it as `expired` (`effectiveStatus()`).
  - **Seats:** anything that counts seats against the quota first locks the `ticket_types` row (`SELECT … FOR UPDATE`): enrolling, seat holds, quota edits and `confirmEnrollment()`.
  - "My tickets" shows confirmed tickets the account bought **or** that carry its email.
- **Seat holds** (`apps/registration`, table `seat_holds`): opening the enroll page of a `first_come` type holds 1 seat for 10 minutes (`POST /ticket-types/:id/hold`), and the form's ticket count resizes it (`PATCH`, same deadline). The web counts down and offers to hold again once it lapses.
  - One hold per account and ticket type. Asking again while it runs returns it unchanged, so a reload or another device carries on with it.
  - `seatsTaken()` counts active holds (`activeHold()`) with active enrollments, and holds count toward `maxPerUser`. `enroll()` leaves the buyer's own hold out of the count and deletes it; the enrollment then holds the seats (35 minutes when paid). A lapsed hold stops counting at once, like a payment hold.
- **Live seats:** the event page, the enroll page and the organizer's ticket pages keep their seat counts current over a WebSocket (`/api/regis/events/:eventId/availability/live`, `useLiveSeats()` in the web).
  - Anything that changes seat counts or the list of ticket types must call `announceSeats(eventId)` from `@app/tickets` **after its transaction commits**. It publishes to the Redis channel `seats:changed`, never throws and doesn't wait.
  - `apps/registration/src/routes/availability/feed.ts` recounts only the events its own sockets watch (at most every 250 ms each, plus a timer for the next lapsing hold, plus a 30s resync in case Redis lost a message) and fans out with Bun's `server.publish`.
  - The socket carries only the counts everyone shares (`held` among them). `mine`, `hold` and `state` still come from the GET, and the web re-derives `sold_out` with `withLiveSeats()`, which must match `getAvailability()`.
- **Payment** (`apps/payment`): `POST /checkout` makes (or reuses) a Stripe Checkout session; `POST /webhook` (`parse: 'none'`, `constructEventAsync`, since the SDK verifies with SubtleCrypto under Bun) confirms the enrollment, or refunds a payment that arrived after its hold lapsed and the seats went.
  - When the webhook never arrives, `POST /checkout/verify` (the order page's "ตรวจสอบการชำระเงิน") asks Stripe about the order's pending sessions and settles them the way the webhook would (`src/libs/settle.ts`). `POST /checkout` does the same first, so it never sends the buyer back to a session that has already been paid.
  - Paid first_come / invite enrollments hold seats for 35 minutes (the 30-minute session plus slack); approved paid ones have 72 hours to pay.
  - Dev: set `STRIPE_WEBHOOK_SECRET` to the `whsec_…` that `bun run stripe:listen` prints (the Stripe CLI needs the events named; the script lists the six events the webhook handles).
  - Stripe setup, from creating a sandbox and a restricted key to the production webhook endpoint: `docs/stripe.md`.
- **Refunds** (`apps/payment`, table `refunds`) are whole-order and cancel the enrollment (`cancelled`, `markCancelled()`), which frees its seats and invitation.
  - The buyer (`POST /refunds`) gets the policy's percent until `starts_at − cutoff`. The policy is the one snapshotted onto `enrollments.refund_percent` / `refund_cutoff_hours` at enroll time, and `refundTerms()` in `@app/tickets` is the one place that reads it.
  - The organizer or an admin (`POST /enrollments/:id/refund`) refunds 100% at any time.
  - `issueRefund()` (`src/libs/refund.ts`) refunds through Stripe only a card payment (`charges.list` tells). Anything else (PromptPay) would need Stripe to email the buyer for a bank account, so it is refunded **by hand**: recorded as `requires_action` with a null `stripe_refund_id`, and the buyer's mail (`libs/mail.ts` sends `manual: true`) asks them to send their order number (the enrollment id) and bank account to the contact channels (`refundContacts` in `apps/mail-worker/emails/_components/refund-claim.tsx`, mock values). Marking such a refund done isn't built yet.
  - For a card, it first looks for a refund Stripe already made for the payment but we never recorded (`refunds.list`, matched on `metadata.paymentId`) and records that one, so a payment is refunded at most once. There is no fixed idempotency key, because Stripe replays a refused request under the same key for 24 hours, even after its cause is fixed. A card refund can fail later, so `refund.updated` / `refund.failed` keep `refunds.status` current.
- Enrollments keep their event, ticket type and invitation with `ON DELETE RESTRICT`, so those services answer `EVENT_HAS_ENROLLMENTS`, `TICKET_TYPE_IN_USE` and `INVITATION_USED` instead.
- Design, lifecycle diagrams and failure modes: `docs/tickets.md`.

### Event cache: `apps/event`

- `GET /api/events/:id` (by uuid or slug) and every route that loads an event through `findVisibleEvent()` read the event detail from Redis first (`src/libs/event-cache.ts`).
  - Keys: `event:id:<uuid>` holds the detail JSON (the API's `EventDetail`), and `event:slug:<slug>` holds the id. TTL is 5 minutes.
  - Visibility is still decided per request from the cached detail (status, `publishAt`, organizer) plus the invitation lookup, so one entry serves every viewer.
  - Lists (`GET /`, `/mine`), the `eventOwner` macro and other services read Postgres directly.
- **Every write to an event must update the cache after it commits:** `refreshEvent(id, previousSlug?)` re-reads the event and replaces the entry, so the next read already sees it.
  - It is called by create, update (including status, slug and suspension) and cover changes. A delete calls `forgetDeletedEvent()`, which leaves a `gone` marker on the id for one TTL. A category rename calls `forgetCategoryEvents()`, since entries embed the category.
  - Readers fill the cache only with `NX`, and refreshes don't overwrite `gone`, so a read or update that raced a write can't put an old copy back.
- Redis failures fall through to Postgres: slower, never wrong.

### Link previews (Open Graph)

Crawlers (LINE, Facebook, X, Discord) read only the HTML and never run the SPA, so the server puts each URL's tags into it.

- **Images** (`apps/event/src/routes/og`): `GET /api/events/og/site`, `/og/events/:id` (uuid or slug) and `/og/categories/:slug` return 1200×630 JPEGs. Takumi (`takumi-js`) renders the node trees in `cards.ts` with Google Sans (latin + thai woff2 from `@fontsource-variable/google-sans`).
  - They read events as an anonymous viewer (`findVisibleEvent(id, null)`), so a draft, scheduled, invite-only or suspended event answers 404 like a missing one.
  - Covers come from `readFile()` in `@app/storage`. Takumi skips bytes it can't decode, and a failed render is retried without images.
  - Dates are formatted in `Asia/Bangkok` (`format.ts`), because the server's time zone is arbitrary.
- **Tags** (`apps/web/server/head.ts`): `resolveHead()` builds the title, description, canonical link and `og:*` / `twitter:card` tags; `injectHead()` puts them between the `<!--head-->` and `<!--/head-->` markers in `index.html`.
  - It reads the event service without a cookie (`EVENT_SERVICE_URL`), waits at most 1.5 s, and otherwise falls back to the site's card. Every value goes through `escapeHtml`, since titles are user input.
  - Absolute URLs use `BETTER_AUTH_URL` as the public origin, like the links in mail.
  - An event's image URL carries `?v=<updatedAt>`, so an edit gives crawlers a new URL. The images themselves are cached for a day (categories for an hour).
  - Dev: the Vite plugin `server/head-plugin.ts` fills the block per request (and with the defaults at build time). Production: `bun run --filter @app/web start` (`server/index.ts`, port 3000) serves `dist/` and fills it per request. The reverse proxy sends `/api/*`, `/files/*` and the WebSocket to the services and the bucket, and everything else to it.
  - The SPA keeps the tab title current with `usePageTitle()` (`src/hooks/use-page-title.ts`), which resets to "Eventide" when the page unmounts. Titles go through `pageTitle()` in `src/lib/site.ts`, which the server shares.

### Frontend: `apps/web`

- **shadcn on Base UI:** the style is `base-maia`, so primitives come from `@base-ui/react`, not Radix. Use Base UI APIs (e.g. the `render` prop instead of `asChild`). The `migrate-radix-to-base` skill covers translating Radix-style examples. For a link styled as a button, apply `buttonVariants()` to a router `Link`, as `navbar.tsx` does. Load the `shadcn` skill before UI work.
- **Components:** always look for a shadcn component first (shadcn MCP / registry). If none fits the feature or design, create one in `src/components/` that follows shadcn theming. That means function components with `data-slot`, `cva` variants, `cn()` for class merging (`cn` comes from the `cn` package, re-exported by `@/lib/utils`), and theme tokens only (`bg-primary`, `text-muted-foreground`, `border`, `ring`, …), with no raw palette colors. Tokens live in `src/index.css` (oklch values for `:root` and `.dark`, teal primary, Google Sans). Dark mode is class-based (`.dark`).
- **Icons (lucide-react) carry meaning, not decoration** (rule and reasons: `apps/web/DESIGN.md`, "Iconography"): use one for an action with a recognised glyph, a direction, a status that must not rest on colour alone, an empty state and navigation; leave it out of form field labels, public and account section headings and anywhere it only repeats the word. Inside `Button`, mark them with `data-icon="inline-start"` or `"inline-end"` so the padding adjusts. Leave out size classes, because `Button` sizes child SVGs itself.
- **Routing:** file-based routes live in `src/routes/` and export `Route = createFileRoute(...)`. `src/routeTree.gen.ts` is generated by the router Vite plugin, so never edit it by hand. Use `@/` for imports from `src`.
- **Server state:** fetch all server state with TanStack Query through the Eden clients. Don't use raw `fetch`.
- **Auth in the web:** the Better Auth client is `auth` in `src/lib/auth-client.ts`; `authClient` in `api.ts` stays the Eden treaty for the auth service.
  - Read the session with `useSession()` / `sessionQueryOptions` from `src/lib/session.ts`. Pages that need a user go under `src/routes/_authed/`, whose `beforeLoad` redirects to `/login?redirect=`. Role checks use `hasRole()` in `beforeLoad`.
  - Map Better Auth errors to the current language with `authErrorMessage()`, and our services' problem documents (looked up by their `code`, never by the backend's Thai `detail`) with `problemMessage()`. Terms and style for both languages: `apps/web/src/i18n/GLOSSARY.md`.
- **Toasts:** this is a Base UI project, so use `toast.add()` from `@/components/ui/toast`, not sonner.
- **Forms:** follow https://ui.shadcn.com/docs/forms/tanstack-form, using `@tanstack/react-form` + zod.
  - Pass the schema as `useForm({ validators: { onSubmit: schema } })`.
  - Each `form.Field` render function returns `<Field data-invalid>` → `<FieldLabel htmlFor>` → a control with `aria-invalid` → `<FieldError errors={field.state.meta.errors}>`.
  - Show the error only when `isTouched && !isValid`.
  - The `<form onSubmit>` calls `e.preventDefault()` and then `form.handleSubmit()`.
  - For text inputs and textareas, `TextField` and `SubmitButton` in `src/components/form-field.tsx` already render this structure (with the label icon and pending spinner).
- **Tables:** follow https://ui.shadcn.com/docs/components/base/data-table, using `@tanstack/react-table` (v9).
  - `columns.tsx` holds the column defs and the row-action dropdown (route-local ones live in a `-components/` folder, which the router ignores).
  - `data-table-features.ts` holds the shared features object.
  - `data-table.tsx` is the generic table.
  - The route fetches data via Query.
- **Hotkeys:** use `@tanstack/react-hotkeys` (`useHotkey("Mod+S", …)`; the event editor's save bar is the example).
- **Drag to reorder:** `@dnd-kit/react` (`DragDropProvider` + `useSortable`, with `isSortable(source)` in `onDragEnd` feeding TanStack Form's `field.moveValue`). The ticket-type question builder is the example; it collapses the other items while dragging because they differ a lot in height.

## Cloud infrastructure (the graded half)

This is the **Cloud Computing 2026 term project** (IT KMITL): graded on both the app and
the infra, with a report and a live demo. The v2 app above was merged onto the existing
infra on 2026-10-24 — spec `docs/superpowers/specs/2026-10-24-v2-infra-merge-design.md`,
plan `docs/superpowers/plans/2026-10-24-v2-infra-merge.md`.

**State:** **one Terraform root, `infra/terraform/`, one state** (`README.md` there):
permanent resources at the root (7 ECR repos, uploads S3 bucket + `public/*` read policy,
SQS mail queue + DLQ, optional `eventide/{google-oauth,stripe,gmail}` secrets, optional
Route 53 zone + ACM cert, and the free VPC network: `network.tf`) and the nightly platform in
`modules/platform` (raw `aws_eks_cluster` + two node groups, NAT gateway + VPC endpoints,
`db.t3.micro` RDS with ONE database `eventide` behind RDS Proxy, ElastiCache Redis, Terraform
ALB + WAF → ingress-nginx NodePort, CloudWatch alarms + dashboard) plus the ingress-nginx /
metrics-server Helm releases, all behind `var.platform` (`make up` = true, `make down` =
false). **Production layout, built and GATE-passed 2026-10-26** (plan:
`docs/superpowers/plans/2026-10-25-production-network.md`; diagram:
`docs/architecture/aws/`). **Credentials go in ONE
place: `infra/aws.env`** (copy of `infra/aws.env.example`; gitignored; sourced by every
Make target and script). `infra/helm/eventide` (auth, event, registration, payment,
mail-worker, redis, web, `/files` → S3, db-migrate hook) ·
`scripts/{tf-init,deploy,teardown,k3d-up,k3d-down,admin,check-lab}.sh`. The k3d parity
GATE passed locally and **the first EKS session passed on 2026-10-24** (account
524450451918, fresh build from zero: `make up` → `make deploy` → health/login/upload/mail/
admin on `http://<nlb>`). **Live at `https://eventide.creasy.club`** (2026-10-25): `creasy.club`'s DNS is
at Cloudflare, which delegates `eventide` (4 NS records) to a Route 53 zone; an ACM wildcard
cert terminates TLS on the NLB (:443); Google sign-in is on; the Stripe and Gmail keys are in
Secrets Manager. Stripe's webhook URL is `https://eventide.creasy.club/api/payment/webhook`.
Not live: the CI deploy job (needs `make ci-creds`).

### Read these before doing anything

| File | Role |
|---|---|
| `docs/SYSTEM-DESIGN.md` | **What** is being built — architecture, services, security, IaC layout. §1.1 lists what the v2 merge changed. |
| `docs/PROJECT-KNOWLEDGE-BASE.md` | **Why** — decision log (with superseded rows), verified lab constraints, trap table, report talking points. |
| `docs/TODO.md` | The build checklist. **`GATE`** items must pass before the next step; cut from the bottom, never a GATE. §0.6 is the current work. |
| `docs/{auth,storage,stripe,tickets}.md` | The v2 app's own design notes. |
| `docs/lab-probe-2026-09-0{6,7}.txt` | Raw output of the AWS Learner Lab capability probes. |

Do not re-litigate decisions recorded in the knowledge-base decision log. If a change
contradicts one, flag it against that entry.

### The governing principle

> Get a hello-world pod answering HTTP on real EKS, deployed by Terraform, before writing a
> single feature.

Infrastructure does not compress under deadline pressure; features do.

### Environment constraints (probed live against Learner Lab accounts 735838417080 and 524450451918, us-east-1)

These are hard and load-bearing — most odd design choices trace back to one of them:

- **$50 hard cap.** Exceeding it locks the account and deletes all work. About `$2` per
  4-hour session with the production layout (an estimate from list prices, ~`$0.5`/h while
  up; it was ~`$1.10` before NAT, endpoints, RDS Proxy, ElastiCache, ALB and WAF); leaving
  the platform layer up exhausts the budget in days.
- **`make down` (`terraform apply -var platform=false`) at the end of every session.**
  The lab auto-stops EC2 only; RDS, the EKS control plane, NAT, interface endpoints,
  RDS Proxy, ElastiCache, the ALB and the WAF keep billing. Worker nodes are in ASGs that
  relaunch lab-stopped instances. The teardown proof lists all of these and `make down`
  exits non-zero unless every list is empty (it once reported success after the lab cut the
  credentials half way through the destroy).
- **No IRSA** (`iam:CreateOpenIDConnectProvider` denied) — also no GitHub Actions OIDC, so
  CI deploys with the session credentials stored as GitHub secrets (`make ci-creds`, see **CI/CD** below). Pods get the lab **session
  credentials** (S3 + SQS) through the `eventide-common` Secret; they expire with the
  session — `make deploy` every session.
- **No `iam:CreateRole`** — Terraform reuses the lab's `LabEksClusterRole` / `LabEksNodeRole`
  via `data "aws_iam_roles"` + `name_regex`. Never hardcode the ARNs.
- **A dedicated VPC `10.20.0.0/16`** (`infra/terraform/network.tf`, free, permanent), **single-AZ
  (us-east-1a)**: the 1b subnets exist only because the ALB, the EKS control plane and the
  RDS subnet group each need two AZs. Probed 2026-10-25: new VPC, NAT/EIP, VPC endpoints,
  ElastiCache, RDS Proxy (`LabRole` trusts `rds.amazonaws.com`) and WAFv2 are allowed;
  **CloudFront and Shield are denied** (hence ALB + WAF; Shield Standard is automatic).
- **An org SCP denies `s3:GetBucketObjectLockConfiguration`** — every bucket is CLI-created
  (`terraform_data` + `local-exec`) and consumed via `data "aws_s3_bucket"`; config goes in
  granular `aws_s3_bucket_*` resources. See `infra/terraform/s3.tf`.
- **`iam:GetRole` on `voclabs` is denied** — rules out `terraform-aws-modules/eks`. Raw
  `aws_eks_*` resources only.
- **Probed 2026-10-24 (account 524450451918):** SQS allowed; no account-level S3 Public Access
  Block, so the `public/*` bucket policy applies. (`scripts/check-lab.sh` prints both.)
- Session credentials expire with the 4-hour session. **Never start an EKS apply after hour 3.**
- Re-run `bash scripts/check-lab.sh` after any lab reset — role suffixes and permissions change.

### Infra architecture in brief

- **One RDS `db.t3.micro`, one database `eventide`, one role, behind RDS Proxy.** The v2
  schema is a single Drizzle schema with cross-table FKs. The services connect to the proxy
  (`DATABASE_URL`); migrations = the chart's `db-migrate` pre-install/pre-upgrade hook
  (`packages/db/Dockerfile`, `drizzle-kit migrate`) connect **direct** to RDS
  (`DATABASE_MIGRATE_URL`, `dbMigrate.urlKey`) — every `make deploy` migrates before pods
  roll. `DB_POOL_MAX=4` per pod; the proxy multiplexes them onto ≤ 87 connections.
  RDS has no backups: the database is rebuilt every session.
- **Network tiers** (`modules/platform/eks.tf`): the **edge** node group (private subnet, **no
  route out**: ingress-nginx, event, registration, web) and the **egress** node group (route
  to the NAT gateway: auth, payment, mail-worker; the only ones that call Google, Stripe or
  Gmail). A pod lives in its node's subnet, so the chart pins them with `nodeSelector
  eventide/tier` (`values.aws.yaml`). The edge tier reaches AWS through VPC endpoints
  (S3 gateway; ecr.api, ecr.dkr, sts, ec2, sqs, secretsmanager).
- **Auth across services** = Better Auth cookie session; `@app/auth-guard` introspects
  `AUTH_SERVICE_URL` (in-cluster `auth` Service) and caches 60 s in **ElastiCache Redis**
  (1 node, TLS + AUTH token, `rediss://`; `REDIS_URL` comes from `eventide/endpoints` via
  `deploy.sh`; there is no redis pod on AWS; losing it is one slow request, never a wrong one).
- **Uploads** go through the owning service; the browser reads `/files/<key>`, which a
  second Ingress rewrites to the bucket on S3 (`values.aws.yaml`) or MinIO (`values.local.
  yaml`). Only `public/*` is readable — the bucket policy decides, not the ingress.
- **Mail** = `@app/mail` → SQS `eventide-mail-queue` → `mail-worker` Deployment → Gmail
  SMTP. Without `eventide/gmail` it runs dry and logs. **Payment** = Stripe; without
  `eventide/stripe` checkout is off. Both are Terraform-managed from gitignored
  `*.auto.tfvars` in `infra/terraform`.
- **ingress-nginx as a `NodePort` Service + an ALB created by Terraform** (never
  `type=LoadBalancer` — that ELB would orphan outside Terraform state). The ALB (HTTPS with the
  ACM cert, :80 → 301, idle timeout 3600 s, health check `/healthz`) has a **WAF** on it
  (`waf.tf`: Common with a multipart scope-down, KnownBadInputs, IP reputation, a per-IP rate
  limit, the Stripe webhook path allowed; `waf_mode` `block` by default, `count` to retune —
  read the per-rule counts before flipping). ingress-nginx takes the client IP from
  `X-Forwarded-For` (trusted from the VPC CIDR only).
- **Monitoring** (`monitoring.tf`): 15 CloudWatch alarms (ALB, RDS, Proxy pinning, Redis, DLQ,
  node CPU, WAF burst) → SNS topic `eventide-alerts` (email opt-in via `alert_email`) and the
  dashboard `eventide`. Container Insights stays off (the node role can't take its policy).
- **Secrets** — `scripts/deploy.sh` builds four k8s Secrets each session: `eventide-common`
  (DATABASE_URL via the proxy, DATABASE_MIGRATE_URL, REDIS_URL — from the `eventide/endpoints`
  secret — plus S3_*, AWS_* session creds, MAIL_QUEUE_URL), `eventide-auth`
  (BETTER_AUTH_SECRET, GOOGLE_*), `eventide-payment` (STRIPE_*), `eventide-mail-worker`
  (GMAIL_*). Same chart on k3d with dev values. **ESO stays off** (SYSTEM-DESIGN §5.2.1).
- **One Terraform root, split by `var.platform`:** permanent resources at the root,
  the nightly EKS, NAT, endpoints, RDS + Proxy, ElastiCache, ALB + WAF and alarms in
  `modules/platform` with `count = var.platform ? 1 : 0`.
  `make down` is `terraform apply -var platform=false` — a normal apply that destroys
  exactly the platform. The state bucket is created by `scripts/tf-init.sh`.
- **DNS/TLS (deployed for `eventide.creasy.club`):** `<sub>.<domain>` delegated to Route 53, apex on Cloudflare; zone + wildcard
  ACM cert are permanent (`infra/terraform/dns.tf`, opt-in via `dns.auto.tfvars`); the ALB
  HTTPS listener + ALIAS record rebuild with the platform (the 2026-10-26 lab deploy predates the ALB/WAF stack and used an NLB TLS listener). Single host — SPA at `/`, APIs at `/api/*`,
  files at `/files/*`, no CORS. Stripe's webhook and Google's redirect URI both need this
  HTTPS host. Never recreate the hosted zone.

### Infra commands

`make dev` (compose + migrate + every app in watch mode) · `make db-reset` · `make k3d` /
`make k3d-down` (local parity: same chart, host compose stack) · `make mirror` (copy the
ingress-nginx and metrics-server images into ECR, once per tag: the edge tier can't pull from
public registries) · `make up` (`tf-init` + `terraform apply` + kubeconfig) · `make plan` ·
**`make deploy` = the one command** (`scripts/bootstrap.sh`: from an empty or just-reset
account to the system serving traffic; on a running platform it is a redeploy; see **After a
lab reset** below) · `make redeploy` (`scripts/deploy.sh` alone: 7 images → ECR, Secrets,
helm upgrade with the migrate hook; app only, what CI runs) · `make admin EMAIL=…` (first admin,
after registering in the web) · `make load BASE_URL=…` (k6 vs `/api/events`) · `make down`
(`teardown.sh`: `platform=false` + proof — every session end). Credentials: `infra/aws.env`.
`bash scripts/check-lab.sh` after every lab reset. CI (`.github/
workflows/ci.yml`): `check` (compose-backed tests incl. mail-worker, web typecheck + build),
`images` (all 7 builds) on PRs and main; `deploy` on push to main — see **CI/CD** below.
`make secrets` copies Google/Gmail/Stripe from the root `.env` into the gitignored
`infra/terraform/*.auto.tfvars` (names/status only are printed), applies just those Secrets
Manager secrets and refreshes the outputs; `make ci-creds [DEPLOY=1]` stores `infra/aws.env`
as the `AWS_*` GitHub secrets.

### CI/CD (push to `main` → AWS)

- The Learner Lab has no OIDC federation, so the `deploy` job authenticates with the session
  credentials in the repository secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
  `AWS_SESSION_TOKEN`. They expire with the lab session (~4 h): **after every Start Lab run
  `make ci-creds DEPLOY=1`** (updates the secrets and re-deploys).
- The job **skips with a notice, never fails**, when the secrets are missing/expired or the
  platform is down — it must not clobber a working cluster with stale credentials. It runs
  `scripts/deploy.sh` (build + push 7 images, 4 k8s Secrets, helm upgrade — the `db-migrate`
  hook migrates first) then curls `/api/*/health` and `/api/events/og/site`.
- `terraform apply` (`make up` / `make down`) stays manual, for cost. Google/Gmail/Stripe live
  in Secrets Manager (via `make secrets`), so CI never holds them. Google sign-in is only
  enabled when the public URL is `https://` (Google rejects http redirect URIs).
- The pods' own AWS credentials (S3 + SQS, `eventide-common`) are whatever the last deploy
  injected — they stop working when that session ends, so redeploy each session.

### Rules that cause slow, confusing bugs if broken

- **Probes hit `GET /api/<prefix>/health`, which must never touch Postgres or Redis.** A
  liveness probe that queries the DB turns a 5-second RDS blip into every pod restarting.
- **`/files/*` is public only under `public/*`.** Never store a private file with a
  `public/` key; never widen the bucket policy.
- **Never break an Elysia method chain** — Eden Treaty's end-to-end types depend on it; a
  broken chain silently degrades the SPA's types to `any`.
- **Request models are Elysia `t` / TypeBox only** (`model.ts`). Zod stays in the web forms.
- **`DB_POOL_MAX`** is the only per-pod DB knob; raising replicas without lowering it exhausts
  `t3.micro`'s ~87 connections and fails the HPA load test on connections, not CPU.
- Bun services must **handle `SIGTERM`** (mail-worker already does; Elysia's `listen` does).
- RDS: `skip_final_snapshot = true`, `deletion_protection = false`, or the nightly destroy fails.
- HPA max is **8 replicas** — a `t3.medium` allows only 17 pods; beyond the ceiling pods sit
  `Pending` with an error that looks like a bug. Run the load test with
  `NODE_INSTANCE_TYPE=t3.medium make up`. A single-source k6 run also trips the WAF's per-IP
  rate rule: raise it for the run (`-var waf_rate_limit=…`).
- **Nothing on the edge tier can pull from a public registry** (no route out; Docker Hub and
  `registry.k8s.io` time out and the pod sits in `ImagePullBackOff`). Every image comes from our
  ECR: the service images via `deploy.sh`, ingress-nginx and metrics-server via `make mirror`
  (`k8s/*` repos). A new third-party image either goes on the egress tier or gets mirrored.
- Changing the VPC or subnets replaces the EKS cluster, the DB subnet group and the load
  balancer: `make down` first (from a checkout whose code matches what is live), then apply.
- `auth`/`registration`/`payment` are `bun build --compile` binaries (Bun 1.4's floor is ~104 MB
  each). `event`, `mail-worker` and `web` are **bundled files on `oven/bun:1-slim`** instead,
  because they need files at runtime: event's OG renderer (`takumi-js`, a native addon + a
  font read from `node_modules`; those two stay external and are installed next to the
  bundle), mail-worker's `emails/static/logo.png` (path from `import.meta.dir`), and the web
  Bun server (`server/index.js` + `dist/`). A compiled binary has none of that. The migrate
  image is ~250 MB. Pushing over a VPN has stalled before — push off-VPN or lower the MTU.

### Open blockers (see `docs/TODO.md` §0)

1. The **assignment brief has never been seen** — every scope decision is inference.
2. Exact **checkpoint date** and what it requires.
3. **Final demo date.**
4. The custom domain needs the Cloudflare delegation to follow the Route 53 zone: see **After a
   lab reset** (automatic with `CLOUDFLARE_API_TOKEN`, otherwise one paste of 4 NS records).

### After a lab reset

Start Lab, paste the three values into `infra/aws.env`, run **`make deploy`**. Nothing else.
`scripts/bootstrap.sh` does, in order: preflight (tools, Docker, credentials) → state
(`tf-init`) → the permanent layer (VPC, ECR, S3, SQS, secrets, Route 53 zone, ACM request;
skipped when the cluster already exists) → DNS delegation (`scripts/delegate-dns.sh`) and a
wait for the certificate → the ECR image mirrors (`make mirror`) → `terraform apply` of the
platform → `scripts/deploy.sh` → a smoke test of the four health endpoints. From zero it
takes about 30-40 min. Things to know:

- A reset deletes the Route 53 zone, so its 4 name servers change and the NS records at
  Cloudflare (the apex lives there) go stale; until they are replaced the certificate cannot
  issue and the ALB's HTTPS listener cannot be created. With `CLOUDFLARE_API_TOKEN` in
  `infra/aws.env` (token: Edit zone DNS, restricted to the apex zone) the script replaces them
  through the API. Without it, it prints the 4 names and, on a terminal, waits until you have
  pasted them; otherwise it exits 3: set them, run `make deploy` again.
- Terraform's state is not trusted for "is it up": the platform counts as live only when the
  cluster exists in the account. After a reset the state may still list resources that are
  gone; the uploads bucket (created by a `local-exec`) is recreated with `-replace` when the
  state remembers it and the bucket is missing.
- `make secrets` is not needed again: the Google/Gmail/Stripe tfvars are local, so the apply
  recreates the Secrets Manager secrets. `scripts/sync-secrets.sh` runs only on a fresh clone
  (it deletes the tfvars of any group `.env` leaves empty, and Terraform would then delete that
  secret).
- **An interrupted run repairs itself.** If the lab cuts the credentials mid-run (it did, halfway
  through `make down`: `explicit deny … voc-cancel-cred`), Terraform leaves `errored.tfstate`
  (the newest state, which it could not upload) and a stale `…/terraform.tfstate.tflock` in the
  state bucket. `scripts/recover-state.sh` runs inside `tf-init` (so `make up`, `make deploy`)
  and inside `make down`: it removes the lock only when no terraform process runs here and the
  lock is older than 5 min, and pushes `errored.tfstate` when it is this account's and newer than
  the remote state of the same lineage (otherwise archives it as `*.foreign-` / `*.stale-`, never
  deleting; a lineage mismatch or a failed push stops with exit 1 for a human). Never run
  `terraform apply` by hand before it has run: that forks the state.
- **`make down` exits non-zero unless it is verifiably clean:** the apply succeeded and every
  verification list is empty. A list it cannot read (credentials cut) is `UNVERIFIED`, never
  "empty". After an interrupted `make down` the platform is still billing: Start Lab and run it
  again.
- The database is new every session, so `make deploy` ends with the **prepared demo** (`scripts/seed-demo.sh` -> `demo/seed.ts`,
  through the public API, idempotent; `SEED_DEMO=0` skips it, `make demo` runs it by hand): accounts (admin, an approved
  organizer, an attendee; random password in `demo/.credentials`, gitignored), six categories with Thai and English names and eight
  events covering every ticket kind and state. The accounts use plus-addresses of the Gmail sender (approval and invitation mails
  are real: an address nobody owns would end in the DLQ). `demo/README.md`; `bun test demo/` checks the data and runs in CI.
- Not automated, by design: the credentials, and `make down` at the end.
- `scripts/{delegate-dns,recover-state,teardown}.test.sh` test the DNS delegation, the state
  recovery and `make down`'s exit codes against stand-ins for Cloudflare, `aws` and `terraform`
  (no token, network or AWS; CI runs them). The from-zero path as a whole needs a real reset to be proven.

### Security

Paste script *output* into chats, never `aws_secret_access_key` / `aws_session_token`. Live
lab credentials were pasted into a chat on 2026-09-06; the session was rotated afterward.
Never commit `.env`, `infra/aws.env` or `*.auto.tfvars`.

## Frontend Design Standards

- Treat UI/UX as a product design discipline, not decoration.
- Follow one coherent art direction per product.
- Inspect existing components and design tokens before
  introducing new patterns.
- Use a deliberate typography scale and consistent spacing.
- Maintain a consistent icon family and interaction language.
- Use animation and visual effects selectively to create
  emphasis, depth, feedback, and delight.
- Avoid generic AI-generated layouts and repetitive card grids.
- Do not add gradients, glow, glass effects, or animations
  unless they improve the intended experience.
- Preserve business logic, data flows, and existing features.
- Test responsive layouts and important interaction states.
- Visually inspect actual rendered pages after meaningful UI
  changes whenever browser tools are available.
- Fix visual inconsistencies instead of merely reporting them.
