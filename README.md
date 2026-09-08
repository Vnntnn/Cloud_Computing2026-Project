# Eventide — Cloud Computing 2026 (IT KMITL)

An event-listing / ticket-registration platform, built as the term project for Cloud
Computing 2026. Graded on **both** the application and the cloud infrastructure, with a
written report and a live demo — so the app is deliberately small and the infrastructure
does the talking.

Three independently deployed Elysia/Bun microservices on EKS, one static React SPA served
from the cluster, one RDS Postgres with a database per service, TLS via Route 53 + ACM on
a Terraform-managed NLB.

| Doc | What's in it |
|---|---|
| [`docs/SYSTEM-DESIGN.md`](docs/SYSTEM-DESIGN.md) | **What** is being built — architecture, data model, security, IaC layout |
| [`docs/PROJECT-KNOWLEDGE-BASE.md`](docs/PROJECT-KNOWLEDGE-BASE.md) | **Why** — decision log, verified lab constraints, trap table |
| [`docs/TODO.md`](docs/TODO.md) | The 4-week build checklist |
| [`CLAUDE.md`](CLAUDE.md) | Guardrails and current state |

## Status

All three services + the SPA are built, containerised, and deployed to real EKS via one
Helm chart; every week-1–4 GATE has passed on the deployed system (rebuild-from-zero,
DB-per-service boundary, S3 presigned upload, HPA 2→8→2). **Left:** apply the Route 53 /
ACM custom domain and wire the Google OAuth client (both plumbed, need a lab session +
external accounts), then the demo rehearsals. See [`docs/TODO.md`](docs/TODO.md).

## Repository layout

```
apps/
  auth/           Elysia · better-auth (Drizzle + jwt + bearer), Google + email/password
  event/          Elysia · event metadata, S3 presigned cover uploads
  registration/   Elysia · tickets, capacity enforced in one local transaction
  web/            Vite + React 19 + Tailwind v4 SPA, served from nginx in-cluster
packages/
  shared/         @eventide/shared — defineEnv (Zod), shared TypeBox models, bearer-JWT macro
  db/             @eventide/db — Drizzle schemas + migrations, bootstrap + seed scripts
docs/             design, knowledge base, TODO, report, demo runsheet
infra/
  terraform/      00-bootstrap (README) · 10-foundation (ECR/S3/Secrets/DNS/OAuth) ·
                  20-platform (EKS/RDS/NLB/ingress-nginx, + addons.tf)
  helm/           ingress-nginx values · eventide/ (the app chart — all 4 services)
  k8s/            raw manifests kept for reference (chart is the deploy path)
scripts/          check-lab · db-bootstrap · deploy · seed · teardown · k3d-up / k3d-down
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

For the AWS/infra work you also need `awscli`, `terraform` (via `brew tap hashicorp/tap`
— not in homebrew-core), `helm`, `kubectl`, and `jq`; `k3d` for local cluster parity and
`k6` for the load test. Install list in **Deploying to AWS → Prerequisites** below.

### First run

```bash
bun install          # installs all workspaces
make dev             # postgres + bootstrap + the 3 services + the SPA, all in watch mode
```

`make dev` will:

1. start a local Postgres container (`docker compose up -d db`),
2. run `packages/db/scripts/bootstrap.ts` — creates the `auth_svc` / `event_svc` /
   `registration_svc` roles and their databases, then applies the Drizzle migrations,
3. `turbo run dev` — the three services (`bun --watch`) and the Vite dev server for `apps/web`.

| Service | URL | Notes |
|---|---|---|
| auth | http://localhost:3000 | port 3000 is fixed — it's the Google OAuth redirect host |
| event | http://localhost:3001 | |
| registration | http://localhost:3002 | |
| web (SPA) | http://localhost:5173 | started by `make dev` too; Vite proxies `/api/*` to the three services |

Check one is up: `curl localhost:3001/health/live` → `{"status":"ok","service":"event"}`.
Interactive API docs: `http://localhost:3001/swagger`.

**Environment.** No `.env` is needed — `packages/shared` `defineEnv` supplies dev defaults
that match `bootstrap.ts`. Google OAuth is **optional in dev**: email/password always works;
set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `apps/auth/.env` only if you want the
Google button (redirect URI `http://localhost:3000/api/auth/callback/google`).

### Demo data

```bash
make seed        # needs `make dev` running — 4 organisers, 15 events,
                 # 5 attendees with tickets, all through the live auth/registration APIs
SEED_FORCE=1 make seed   # wipe and re-seed
```

### Without Make

```bash
docker compose up -d db
bun run --filter @eventide/db db:bootstrap
bun run dev                     # turbo run dev — the 3 services + the SPA
```

Run one workspace only: `bun run --filter @eventide/event dev`

### Local Kubernetes parity (k3d)

Run the **same Helm chart and manifests** as EKS on a local k3d cluster — catches
manifest/ingress problems without a lab session or any cost:

```bash
make k3d          # scripts/k3d-up.sh — k3d cluster + ingress-nginx + the eventide chart
                  # → http://localhost:8080  (curl localhost:8080/api/events)
make k3d-down     # delete it
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

## Deploying to AWS

Deployment is a **local script run with fresh lab credentials** — the AWS Academy Learner
Lab has no OIDC provider (so no GitHub Actions deploy) and session credentials expire in
4 hours. Full rationale and the trap table: [`infra/terraform/README.md`](infra/terraform/README.md)
and [`docs/PROJECT-KNOWLEDGE-BASE.md`](docs/PROJECT-KNOWLEDGE-BASE.md).

### Prerequisites

```bash
brew tap hashicorp/tap
brew install awscli hashicorp/tap/terraform helm kubectl jq   # k6 for the load test
```

Also: Docker running (image builds), and an AWS Academy Learner Lab (or any AWS account —
override `account_id` / `region`, see `infra/terraform/*/README.md`).

### One-time setup (per AWS account)

| Step | Command | Creates |
|---|---|---|
| 1. State bucket | by hand — [`infra/terraform/00-bootstrap/README.md`](infra/terraform/00-bootstrap/README.md) | the S3 bucket holding Terraform state |
| 2. Foundation | `terraform -chdir=infra/terraform/10-foundation init && terraform -chdir=infra/terraform/10-foundation apply` | ECR repos, uploads S3 bucket, `eventide/{auth,event,registration}` secrets — **permanent, never destroyed** |
| 3. Custom domain *(optional)* | fill `10-foundation/dns.auto.tfvars`, re-apply, then paste `terraform output route53_name_servers` into your DNS host as `NS` records for the delegated subdomain | Route 53 zone + wildcard ACM cert for `events.<domain>` |
| 4. Google OAuth *(optional)* | fill `10-foundation/google.auto.tfvars`, re-apply | `eventide/google-oauth` secret |

Config files — **all gitignored, never committed:**

| File | Purpose |
|---|---|
| `~/.aws/credentials` `[default]` | lab session creds (`aws_access_key_id` / `_secret_access_key` / `_session_token`). Paste from Learner Lab → *AWS Details*. **Into the file, never a chat/commit.** |
| `infra/terraform/10-foundation/dns.auto.tfvars` | `dns_domain = "example.com"` — enables the Route 53 / ACM custom domain. Absent → deploy serves over the bare NLB (`http://<nlb>`). |
| `infra/terraform/10-foundation/google.auto.tfvars` | `google_client_id` / `google_client_secret` from Google Cloud Console. Absent → auth runs email/password only. |

`*.auto.tfvars.example` files next to each show the shape. `20-platform` needs no config —
it reads the domain/cert from `10-foundation`'s state automatically.

### Every session

```bash
# 1. Learner Lab → Start Lab → paste AWS creds into ~/.aws/credentials, then:
aws configure set region us-east-1
bash scripts/check-lab.sh          # role suffixes change on every lab reset — must pass

# 2. Bring up the platform (~17 min: EKS + node group + RDS + NLB + ingress-nginx)
make up                            # terraform apply 20-platform, then kubectl get nodes → 2 Ready

# 3. Create the databases + roles + run migrations (one-shot Job, idempotent)
make db-bootstrap

# 4. Build + push all 4 images, helm upgrade, roll out
make deploy                        # PUBLIC_URL defaults to the custom domain if DNS is set,
                                   #   else http://<nlb>. Override: PUBLIC_URL=https://... make deploy

# 5. Demo data (runs in-cluster — RDS is private)
make seed-eks

# 6. Smoke test  (deploy.sh prints the exact URLs)
curl http://<nlb>/health/live
curl http://<nlb>/api/events

# 7. ALWAYS at session end — destroy 20-platform and verify nothing survived
make down                          # then check the lab credit (~$1.10/session expected)
```

`10-foundation` is **not** touched per session — apply it once and leave it. Never start
`make up` after hour 3 of a lab session: credentials expire mid-apply and leave a billable
half-built stack.

### Autoscaling load test

```bash
make up NODE_INSTANCE_TYPE=t3.medium      # t3.small's ~11-pod ceiling is too tight for HPA-to-8
#   (or: terraform -chdir=infra/terraform/20-platform apply -var node_instance_type=t3.medium)
make load BASE_URL=http://<nlb>           # k6, 0→200 VUs over ~10 min
kubectl -n eventide get hpa -w            # watch replicas 2 → 8 → 2
```

## CI

`.github/workflows/ci.yml` runs `lint · check-types · test · build` on every push and PR.
It does **not** touch AWS — deployment to EKS is a local script, because the AWS Academy
Learner Lab has no OIDC provider and session credentials expire in 4 hours.

## Conventions

- **Never break an Elysia method chain** — Eden Treaty's end-to-end types depend on it.
- **Request models are Elysia `t` / TypeBox only.** Zod (v4 — use `z.url()`, not
  `z.string().url()`) is confined to boot-time env validation.
- **`/health/live` must never touch the database** — only `/health/ready` does.
- **Services handle `SIGTERM`** for graceful shutdown.

More in [`CLAUDE.md`](CLAUDE.md).
