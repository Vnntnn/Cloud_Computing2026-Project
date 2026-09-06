# Eventide — Cloud Computing 2026 (IT KMITL)

An event-listing / ticket-registration platform, built as the term project for Cloud
Computing 2026. Graded on **both** the application and the cloud infrastructure, with a
written report and a live demo — so the app is deliberately small and the infrastructure
does the talking.

Three independently deployed Elysia/Bun microservices on EKS, one static React SPA on
S3 + CloudFront, one RDS Postgres with a database per service.

| Doc | What's in it |
|---|---|
| [`docs/SYSTEM-DESIGN.md`](docs/SYSTEM-DESIGN.md) | **What** is being built — architecture, data model, security, IaC layout |
| [`docs/PROJECT-KNOWLEDGE-BASE.md`](docs/PROJECT-KNOWLEDGE-BASE.md) | **Why** — decision log, verified lab constraints, trap table |
| [`docs/TODO.md`](docs/TODO.md) | The 4-week build checklist |
| [`CLAUDE.md`](CLAUDE.md) | Guardrails and current state |

## Status

Monorepo scaffolded; the three services answer HTTP and compile to container images.
**Not yet:** `apps/web`, `infra/` (Terraform/Helm/k8s), and all feature code.

## Repository layout

```
apps/
  auth/           Elysia · better-auth (Drizzle + jwt + bearer)         [hello-world]
  event/          Elysia · events, S3 presigning                        [hello-world]
  registration/   Elysia · tickets, capacity enforcement               [hello-world]
packages/
  shared/         @eventide/shared — defineEnv (Zod), shared TypeBox models
  db/             @eventide/db — Drizzle schemas + migrations, bootstrap script
docs/             design, knowledge base, TODO
infra/            (not created yet) terraform / helm / k8s
```

Each service follows the Elysia feature-module shape (`src/index.ts` root + a
`src/modules/<domain>/{index,service,model}.ts` per domain). See
[`SYSTEM-DESIGN.md` §12.2](docs/SYSTEM-DESIGN.md).

---

## Development setup

### Prerequisites

| Tool | Version | Why |
|---|---|---|
| [Bun](https://bun.sh) | ≥ 1.4 | runtime, package manager, test runner, bundler |
| Docker | any recent | local Postgres for `make dev` |
| GNU Make | any | task shortcuts (optional — commands work without it) |

AWS-side tools (`awscli`, `terraform`, `helm`, `k3d`, `k6`) are **not** needed yet —
they come with the `infra/` work in weeks 1–2 (see `docs/TODO.md`).

### First run

```bash
bun install          # installs all workspaces
make dev             # postgres + bootstrap + the 3 services in watch mode
```

`make dev` will:

1. start a local Postgres container (`docker compose up -d db`),
2. run `packages/db/scripts/bootstrap.ts` — creates the `auth_svc` / `event_svc` /
   `registration_svc` roles and their databases, then applies the Drizzle migrations,
3. start the three services with `bun --watch`.

| Service | URL | Notes |
|---|---|---|
| auth | http://localhost:3000 | port 3000 is fixed — it's the Google OAuth redirect host |
| event | http://localhost:3001 | |
| registration | http://localhost:3002 | |

Check one is up: `curl localhost:3001/health/live` → `{"status":"ok","service":"event"}`.
Interactive API docs: `http://localhost:3001/swagger`.

### Without Make

```bash
docker compose up -d db
bun run --filter @eventide/db db:bootstrap
bun run dev                     # turbo run dev — all three watchers
```

Run a single service:

```bash
bun run --filter @eventide/event dev
```

---

## Common commands

```bash
bun run lint            # biome check, all packages
bun run check-types     # tsc --noEmit, all packages
bun run test            # bun test, all packages
bun run build           # compile each service to a Bun binary (dist/server)
bun run format          # biome format --write

# one package only
bun run --filter @eventide/event check-types
```

`turbo` caches task results, so re-runs are near-instant until inputs change.

### Database

After changing a Drizzle schema in `packages/db/src/<svc>/schema.ts`:

```bash
bun run --filter @eventide/db generate:event          # or generate:registration
make bootstrap                                         # re-applies migrations (idempotent)
```

`auth_db`'s schema is owned by the better-auth CLI, not drizzle-kit — do not hand-write it.

Reset local data: `docker compose down -v && make bootstrap`.

### Containers

Build context is the **repo root**; build for the EKS node architecture:

```bash
docker build -f apps/event/Dockerfile --platform linux/amd64 -t eventide/event .
docker run --rm -p 3000:3000 eventide/event
curl localhost:3000/health/live
```

Images are a compiled Bun binary on `distroless/base-debian12` (~46 MB) — see
[`SYSTEM-DESIGN.md` §12.1](docs/SYSTEM-DESIGN.md).

---

## CI

`.github/workflows/ci.yml` runs `lint · check-types · test · build` on every push and PR.
It does **not** touch AWS — deployment to EKS is a local script (weeks 1–2), because the
AWS Academy Learner Lab has no OIDC provider and session credentials expire in 4 hours.

## Conventions

- **Never break an Elysia method chain** — Eden Treaty's end-to-end types depend on it.
- **Request models are Elysia `t` / TypeBox only.** Zod (v4 — use `z.url()`, not
  `z.string().url()`) is confined to boot-time env validation.
- **`/health/live` must never touch the database** — only `/health/ready` does.
- **Services handle `SIGTERM`** for graceful shutdown.

More in [`CLAUDE.md`](CLAUDE.md).
