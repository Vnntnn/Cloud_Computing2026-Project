# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

The **Cloud Computing 2026 term project** for IT KMITL (repo `Cloud_Computing2026-Project`,
working name "Eventide"): an event-listing / ticket-registration platform, graded on **both
the application and the cloud infrastructure**, with a written report and a live demo.

**Current state: monorepo scaffolded, infra not started.** The Bun/Turborepo workspace
exists — `apps/{auth,event,registration}` (hello-world Elysia services: `/`, `/health/live`,
`/health/ready`, `/swagger`, `SIGTERM`), `packages/{shared,db}` (`defineEnv`, real Drizzle
schemas + `0000` migrations for event/registration, `scripts/bootstrap.ts`). `make dev`
runs all three against a local Postgres. Services compile to a Bun binary on distroless
(§12.1) — verified: `apps/event` image is 45.8 MB and serves all routes. **Still no
`apps/web` (week 3), no `infra/` (Terraform/Helm/k8s — weeks 1–2), no feature code.**

### Read these before doing anything

| File | Role |
|---|---|
| `docs/SYSTEM-DESIGN.md` | **What** is being built — architecture, services, data model, security, IaC layout. |
| `docs/PROJECT-KNOWLEDGE-BASE.md` | **Why** — decision log with rejected alternatives, verified lab constraints, trap table, report talking points, open questions. |
| `docs/TODO.md` | The 4-week build checklist. Items marked **`GATE`** must pass before the next day; if a day runs long, cut from the bottom, never a GATE. |
| `docs/lab-probe-2026-09-06.txt` | Raw output of the AWS Learner Lab capability probe. |

Do not re-litigate decisions recorded in the knowledge-base decision log. If a change
contradicts one, flag it against that entry.

## The governing principle

> Get a hello-world pod answering HTTP on real EKS, deployed by Terraform, before writing a
> single feature.

The design is deliberately **feature-poor and infrastructure-heavy**: the smallest app that
still justifies a real microservice topology and exercises every required AWS service.
Infrastructure does not compress under deadline pressure; features do.

## Environment constraints (probed live against AWS account 735838417080, us-east-1)

These are hard and load-bearing — most odd design choices trace back to one of them:

- **$50 hard cap.** Exceeding it locks the account and deletes all work. `~$1.10` per 4-hour
  session; leaving the platform layer up exhausts the budget in ~15 days.
- **`terraform destroy` the `20-platform` layer at the end of every session.** The lab
  auto-stops EC2 only; RDS, the EKS control plane and ELBs keep billing. Worker nodes are in
  an ASG that relaunches lab-stopped instances.
- **No IRSA** (`iam:CreateOpenIDConnectProvider` denied) — also means no GitHub Actions OIDC,
  so CI builds images only and deploy is a local script.
- **No `iam:CreateRole`** — Terraform must reuse the lab's pre-created `LabEksClusterRole` /
  `LabEksNodeRole`, looked up with `data "aws_iam_roles"` + `name_regex`. Never hardcode the
  ARNs; the prefix changes on every lab reset and differs per teammate account.
- **Default VPC only, no NAT gateway.** Pin subnets to **us-east-1a/b/c** (1e lacks capacity).
- Session credentials (`ASIA…`) expire with the 4-hour session. **Never start an EKS apply
  after hour 3.**
- Re-run `bash scripts/check-lab.sh` after any lab reset — role suffixes and permissions change.

## Architecture in brief

Three independently deployed Elysia/Bun microservices on EKS, one static React SPA on
S3 + CloudFront:

- **auth** — better-auth (Drizzle adapter + JWT plugin + bearer plugin), Google OAuth +
  email/password, owns `auth_db`. Exposes `/api/auth/jwks`.
- **event** — event metadata + S3 presigned cover-image upload, owns `event_db`.
- **registration** — tickets, **owns and enforces capacity** by counting its own rows in one
  local transaction; calls `event` in-cluster to enrich "my tickets" with titles. Owns
  `registration_db`.

Cross-cutting:

- **One RDS `db.t3.micro`, one database per service.** Postgres cannot join across databases —
  the service boundary is engine-enforced. No cross-service foreign keys or joins.
- **Auth is stateless across services via JWKS.** `event` / `registration` fetch public keys
  from `auth`'s `/api/auth/jwks` and verify locally with `jose` — no hop to `auth`, no DB call.
  They hold only a public key and cannot mint tokens.
- **Bearer tokens (`Authorization: Bearer`), never cookies** — identical behaviour in dev
  (`localhost`) and deployed, avoids two SameSite configs.
- **ingress-nginx as a `NodePort` Service + an NLB created by Terraform** (not
  `Service type=LoadBalancer`, whose ELB is invisible to Terraform state and orphans on destroy).
- **External Secrets Operator** — the app only ever reads `process.env`. On EKS, ESO fills
  K8s Secrets from Secrets Manager; on k3d, `kubectl create secret` from a local file. Same code.
- **Terraform split by lifetime:** `00-bootstrap` (state bucket, by hand) · `10-foundation`
  (ECR, S3, Secrets Manager — never destroyed) · `20-platform` (EKS, RDS, NLB — destroyed nightly).
- **Presigned S3 URLs** for uploads — bytes never enter the cluster.

## Tooling / commands

- Package manager: **Bun** (primary), workspaces + `bun.lock`. Task runner: **Turborepo**
  (`turbo run lint check-types test build`). Lint/format: **Biome** (`biome.json` at root).
- `make db` (compose Postgres) · `make bootstrap` (create 3 DBs+roles, run migrations via
  `packages/db/scripts/bootstrap.ts`) · `make dev` (bootstrap + `bun --watch` ×3).
- `make k3d` / `make deploy` / `make teardown` — **stubs** that exit non-zero pointing at
  `docs/TODO.md`; real targets land with `infra/` in weeks 1–2.
- Drizzle: `bun run --filter @eventide/db generate:event` / `generate:registration` after a
  schema change. `auth_db` schema is better-auth's CLI, not drizzle-kit.
- `scripts/check-lab.sh` — probes lab capabilities, prints no secrets.
- Still planned (not created): `apps/web` (week 3),
  `infra/terraform/{00-bootstrap,10-foundation,20-platform}`, `infra/helm/eventide`,
  `infra/k8s`, `scripts/{deploy,teardown,lab-creds}.sh`.

## Rules that cause slow, confusing bugs if broken

- **`/health/live` must never touch the database.** Only `/health/ready` checks the DB
  connection. A liveness probe that queries Postgres turns a 5-second RDS blip into every pod
  restarting at once.
- **Never break an Elysia method chain.** Eden Treaty's end-to-end types depend entirely on
  that inference; a broken chain silently degrades the SPA's types to `any` with no error.
- **Request models are Elysia `t` / TypeBox only, registered via `.model()`.** Zod is confined
  to boot-time env validation. A parallel schema system breaks Eden inference.
- **Zod is v4 — use top-level format schemas** (`z.url()`, `z.email()`, `z.uuid()`), not the
  deprecated `z.string().url()` methods. `z.coerce.number()` is still fine. Plain `z.string()`
  for `postgres://` DSNs.
- **better-auth generates `id` as `text`, not `uuid`.** `event_db.owner_id` and
  `registration_db.user_id` are `text`. Do not "fix" to `uuid`.
- **`auth_db` schema is owned entirely by better-auth** — generate migrations with its CLI,
  do not hand-write.
- Bun services must **handle `SIGTERM`** (`process.on("SIGTERM", () => server.stop())`).
- **Delegate a subdomain to Route 53, never the apex.** Route 53 / ACM / CloudFront are still
  unprobed — run the extended `check-lab.sh` before building the TLS design on them.
- RDS: `skip_final_snapshot = true`, `deletion_protection = false`, or nightly destroy fails.
- HPA max is **8 replicas** — a `t3.medium` allows only 17 pods; beyond the ceiling pods sit
  `Pending` with an error that looks like a bug.

## Open blockers (see `docs/TODO.md` §0)

1. The **assignment brief has never been seen** — every scope decision is inference. If the
   rubric names Prometheus or mandates more services, decisions flip. Ask for it as plain text.
2. Exact **checkpoint date** and what it requires (proposal / slides / working code).
3. **Final demo date** — Week 4 assumes ~2 October 2026.
4. What `shadcn --preset bfEjlVBAI` configures — specifically Tailwind v3 vs v4. A
   major-version mismatch is where this frontend stack reliably breaks.

## Security

Paste script *output* into chats, never `aws_secret_access_key` / `aws_session_token`. Live
lab credentials were pasted into a chat on 2026-09-06; the session was rotated afterward.
