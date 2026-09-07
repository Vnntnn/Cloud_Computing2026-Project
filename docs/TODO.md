# TODO

Working checklist for the 4-week build. Companions:
[`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) (what) · [`PROJECT-KNOWLEDGE-BASE.md`](./PROJECT-KNOWLEDGE-BASE.md) (why).

**How to use this.** Items marked **`GATE`** must pass before moving to the next day —
they are the things that get catastrophically expensive to discover late. Everything else
can slip. If a day runs long, cut from the *bottom* of that day, never from a GATE.

---

## 0. Blockers — resolve first

- [ ] **Get the assignment brief as plain text.** Four image attempts have failed. Every
      scope decision (3 services, cutting Prometheus, frontend priority) is inference until
      this is read.
- [ ] Confirm the **exact checkpoint day** and what it requires — proposal, design
      presentation, or working code.
- [ ] Confirm the **final demo date**. Week 4 below assumes ~2 October.
- [x] `shadcn --preset bfEjlVBAI` → **Tailwind v4** (confirmed by the user 2026-09-07).
      `apps/web` is set up for v4; the preset itself was not run (components hand-rolled).

---

## 1. Daily ritual

### Every session start  (see `docs/week1-closeout.md` for the copy-paste version)

- [ ] Learner Lab → **Start Lab**. Note the credit remaining.
- [ ] Copy AWS CLI credentials into `~/.aws/credentials` (they expire with the session).
- [ ] `bash scripts/check-lab.sh` — role suffixes / denials change on every reset.
- [ ] `make up` — `terraform apply 20-platform` (~18 min) + kubeconfig + `get nodes`.
- [ ] `bash scripts/db-bootstrap.sh` — build+push the db-bootstrap image, run the Job.
- [ ] `make deploy` (Helm, all 3 services) then `make seed AUTH_URL=http://<nlb>`.
- [ ] `scripts/lab-creds.sh` is **not needed** on the current path — `deploy.sh` builds the
      k8s Secrets from `eventide/rds-master` and no app code calls the AWS SDK.

### Every session end — non-negotiable

- [ ] `./scripts/teardown.sh`
- [ ] **Read its verification output.** Empty results for EKS, RDS, ELB and running EC2.
- [ ] Check credit remaining. Expect roughly **$1.10 per 4-hour session**. Anything
      significantly higher means something survived teardown — find it now, not tomorrow.

> **Never start a `terraform apply` after the third hour of a session.** Credentials expire
> mid-run and leave a half-built stack that is billable and awkward to clean up.

---

## 2. Week 1 — Infrastructure spike + checkpoint (7–13 Sep)

Goal: **a hello-world pod answering HTTP on real EKS, deployed by Terraform.** No features.

### Day 1 (Mon) — account, tooling, foundation

- [ ] Learner Lab → **End Lab → Start Lab** (rotates the credentials pasted into chat).
- [ ] `brew install awscli terraform helm k3d k6` — currently only `kubectl`, `docker` and
      `bun` are installed.
- [ ] **AWS Budgets alarm at $10**, email to yourself. *Do this before anything else.*
- [ ] Run `bash scripts/check-lab.sh`; save the output to `docs/lab-probe-<date>.txt`.
  - [ ] **Record whether Route 53 / ACM / CloudFront are permitted** — the TLS design
        depends on it and it is currently unverified.
  - [x] **`iam:AttachRolePolicy` — DENIED** (confirmed 2026-09-07, `docs/lab-probe-2026-09-07.txt`).
        So the ESO node-role/IMDS path is out; `deploy.sh` assembles the k8s Secrets from
        `eventide/rds-master` instead (already built). Node role already carries
        `AmazonEKS_CNI_Policy` + `AmazonEC2ContainerRegistryReadOnly` + `AmazonEKSWorkerNodePolicy`.
  - [x] **CloudFront — DENIED** (`cloudfront:ListDistributions` AccessDenied). Route 53 /
        ACM `list-*` returned empty with no error → probably permitted, needs a real create
        to confirm. TLS design leans Cloudflare-proxied (§5.5.1 option 1).
- [x] Create the Terraform state bucket by hand (`aws s3api` commands); documented in
      `infra/terraform/00-bootstrap/README.md`. *(bucket `eventide-tfstate-735838417080`,
      versioned + PAB + AES256; S3 native locking, no DynamoDB.)*
- [x] Write `10-foundation`: ECR repos ×3, S3 bucket (uploads), 3 Secrets Manager secrets.
- [x] `terraform apply` on `10-foundation`. *(18 resources, 2026-09-07. The uploads bucket is
      a `terraform_data`+`local-exec` CLI create consumed as `data "aws_s3_bucket"` — the org
      SCP denies `s3:GetBucketObjectLockConfiguration`, which `aws_s3_bucket` reads. All bucket
      config stays in TF. See `docs/lab-probe-2026-09-06.txt`.)*
- [x] **`GATE`** — `aws ecr describe-repositories` and `aws secretsmanager list-secrets`
      both return your resources. *(pass: `eventide/{auth,event,registration}` in both.)*

### Day 2 (Tue) — the cluster

- [x] Write `20-platform`: `data "aws_iam_roles"` lookups (`one()`), default-VPC data
      sources (**us-east-1a/b/c, default-for-az only**), **raw `aws_eks_cluster` +
      `aws_eks_node_group`** (NOT the module — it `GetRole`s `voclabs`, denied by
      `Pvoclabs2`; native `bootstrap_cluster_creator_admin_permissions` instead), vpc-cni/
      kube-proxy/coredns addons, `t3.small` node group. Plus RDS, the Terraform-managed NLB
      (2 TG + ASG attachments), and the `eventide/rds-master` secret.
- [x] `terraform apply`. *(2026-09-07, 19 resources, clean on the first real attempt after
      the module→raw rewrite. Cluster 10m, node group 3m, RDS 5m.)*
- [x] **`GATE`** — `kubectl get nodes` shows 2 nodes `Ready`. *(pass: 2 × Ready on v1.33,
      aws-node/coredns/kube-proxy all Running, creator has cluster admin.)*
- [x] Write `scripts/teardown.sh` **now**, before there is much to tear down.
      *(kubectl LB sweep → `destroy` → verify EKS/RDS/ELB/EC2/TG all empty.)*
- [x] Run a full `destroy`, confirm clean, then `apply` again. Time both. *(2026-09-07:
      destroy ~10 min; rebuild from zero ~20 min — cluster 10m27s, node group 1m53s, RDS
      5m27s, NLB 2m38s. Both nodes Ready, system pods Running.)*
- [x] **`GATE`** — teardown verification output is empty on every check. *(pass:
      `scripts/teardown.sh` — EKS/RDS/ELBv2/classic-ELB/EC2/target-groups all empty.
      `10-foundation` intact.)*

### Day 3 (Wed) — first service reachable

- [x] Minimal Elysia service: `GET /`, `/health/live`, `/health/ready`, `SIGTERM` handler.
      *(all three services — `apps/{auth,event,registration}`, done in monorepo init.)*
- [x] Multi-stage Dockerfile — compiled Bun binary on `distroless/base-debian12` (§12.1
      updated from `oven/bun:1-alpine`). `apps/event` image verified at 45.8 MB.
- [x] Build → push to ECR → Deployment + Service manifests → `kubectl apply`.
      *(`infra/k8s/event.yaml` — ns/Deployment(2)/Service/Ingress. Image `eventide/event:v1`
      built `--platform linux/amd64`, 43.7 MB, pushed. Fix: distroless `:nonroot` needs
      `runAsUser: 65532` numerically + a `/tmp` emptyDir with `readOnlyRootFilesystem`.)*
- [x] Install **ingress-nginx** as a `NodePort` Service. *(Helm `ingress-nginx` 4.15.1,
      `infra/helm/ingress-nginx.values.yaml` — NodePort 30080/30443, 2 replicas
      `externalTrafficPolicy: Local`, default IngressClass. Now a `helm_release` in
      `20-platform/addons.tf` — `make up` installs it with the cluster.)*
- [x] Add the **NLB to Terraform**, targeting the node group. *(done in `20-platform/nlb.tf`
      — `aws_lb` network + 2 target groups + listeners + `aws_autoscaling_attachment`.)*
- [x] **`GATE`** — the NLB hostname returns your service in a browser. *(pass:
      `http://eventide-ingress-*.elb.amazonaws.com/health/live` → `{"status":"ok",
      "service":"event"}`; `/api/events` → `[]`; `/swagger` → 200.)*
- [x] From inside a pod: `curl https://accounts.google.com`. *(pass: `302` — egress via IGW,
      no NAT gateway. OAuth path is clear.)*

### Day 4 (Thu) — local parity + database

- [x] `k3d cluster create eventide --agents 2 --registry-create eventide-registry:5111
      --k3s-arg "--disable=traefik@server:*"` — `scripts/k3d-up.sh` / `make k3d`
      (idempotent create + `--port 8080:30080@loadbalancer` / `8443:30443`). k3s v1.35,
      1 server + 2 agents. `make k3d-down` deletes it (no cost, no verify sweep).
- [x] Install ingress-nginx locally. Deploy the **same** manifests. *(same
      `infra/helm/ingress-nginx.values.yaml` + a 2-line k3d overlay
      `ingress-nginx.values.local.yaml` — `externalTrafficPolicy: Cluster` (k3d serverlb
      round-robins all 3 nodes) + `replicaCount: 1`. App manifest `infra/k8s/event.yaml`
      applied byte-identical; image from the k3d registry instead of ECR, native arm64
      build, no `--platform`.)*
- [x] **`GATE`** — identical manifests work on k3d and EKS. *(pass 2026-09-06:
      `curl http://localhost:8080/{health/live,health/ready,api/events,swagger}` → same
      200s / same JSON as the EKS NLB GATE; both `event` pods spread across the 2 agents.)*
- [x] Add RDS to `20-platform`: `db.t3.micro`, `skip_final_snapshot = true`,
      `deletion_protection = false`, SG allowing only the node SG. *(done Day 2 —
      `20-platform/rds.tf`, `storage_encrypted = true`, `backup_retention_period = 0`.)*
- [x] Kubernetes `Job` — creates `auth_db`/`event_db`/`registration_db` + owner roles,
      runs the drizzle migrations. **DONE against RDS 2026-09-07.** Image slimmed
      185 MB → 89 MB (`oven/bun:1-slim` + focused `bun add`, not the monorepo lockfile) —
      the ECR push that stalled on the VPN now goes through. Job completes in ~11 s.
      Fixes found on the first real run: `USER bun` → `USER 1000` (k8s `runAsNonRoot`
      needs a numeric uid), and `?sslmode=require` on `MASTER_DATABASE_URL` (RDS PG16's
      default parameter group sets `rds.force_ssl=1`).
- [x] **`GATE`** — full `destroy`, then rebuild from zero, end to end. **PASSED 2026-09-07.**
      `make down` (25 res, verify sweep empty everywhere) — **8m56s**. `make up` from
      nothing — **16m37s**. Then `db-bootstrap.sh` → `deploy.sh` (helm, 4 services all
      rolled out) → `seed.sh` (in-cluster; RDS is private) → 15 events, and the full app
      flow (sign-in → JWT → book → my tickets) + the cross-DB boundary
      (`event_svc` → `registration_db` = `permission denied`) all green through the fresh
      NLB. 5 automation bugs found + fixed during the rebuild (numeric USER, sslmode,
      web ECR repo, `BETTER_AUTH_SECRET` length, in-cluster seed) — all committed.
      Runbook: `docs/week1-closeout.md`.

### Day 5 (Fri) — checkpoint

- [x] Slides — `docs/checkpoint.html` (12 slides, keyboard-nav). Architecture SVG,
      the lab-denial table + what each forced, IaC split, the verified Week-1 gates
      (rebuild 8:56→16:37), trade-offs, cost, weeks 2–4, the 6-move demo. Published:
      `https://claude.ai/code/artifact/73239e17-1c72-43f2-9741-ce31432e05c9`
- [ ] Rehearse the live bit (needs a lab session).
- [ ] **Present.** *(date unconfirmed — blocker §0)*
- [ ] `./scripts/teardown.sh` and verify.

---

## 3. Week 2 — auth and event (14–20 Sep)

### Monorepo and data

- [x] Turborepo skeleton: `apps/{auth,event,registration}`, `packages/{shared,db}`.
      *(`apps/web` deferred to week 3. Bun workspaces + Turborepo + Biome.)*
- [x] Drizzle schemas for `event_db` / `registration_db` — `owner_id` / `user_id` are
      `text`. `0000` migrations generated. `auth_db` stays better-auth's CLI.
- [x] `auth_db` schema — **generated** by the better-auth CLI to
      `packages/db/src/auth/schema.ts` (`bun run --filter @eventide/auth generate:auth-schema`),
      then diffed to SQL by drizzle-kit (`generate:auth`, config `drizzle.auth.config.ts`).
      `user`/`session`/`account`/`verification`/`jwks`. `0000` migration committed. Biome
      ignores the generated file. *(Deviation from the old bootstrap comment: the better-auth
      CLI can't migrate a Drizzle setup — it emits the schema, drizzle-kit runs it, same as
      the other two services.)*
- [x] Migration path: `packages/db/scripts/bootstrap.ts` creates **all three** roles + DBs
      and runs `drizzle-kit migrate` for all three (auth_db included). `make bootstrap` → 3
      DBs migrated clean.
- [x] Seed: `packages/db/scripts/seed.ts` (`make seed` / `db:seed`) — idempotent, creates 4
      organiser accounts **through the auth service** (better-auth owns password hashing,
      §5.1.1) and 15 events into `event_db` owned by them. `SEED_FORCE=1` re-seeds. Runs
      against the live services (local after `make dev`, in-cluster as a Job). Verified
      locally: 15 events / 4 owners. *(Registrations not seeded — needs the registration
      service, week 3.)*
- [x] **`GATE`** — teardown, rebuild, and the seeded app looks demo-ready with no manual
      steps. **PASSED 2026-09-07** as part of the Week-1 rebuild-from-zero: `make down` →
      `make up` → `db-bootstrap.sh` → `deploy.sh` → `seed.sh` → 15 events + the full app
      flow, no manual steps.

### auth service

- [x] better-auth + Drizzle adapter + **JWT plugin** + **bearer plugin**.
      *(`apps/auth/src/lib/{auth,db}.ts`; `.all('/api/auth/*', → auth.handler)` in
      `index.ts`, not `.mount`, to keep the method chain unambiguous. `/health/ready` now
      does a real `select 1`. better-auth 1.7.3, drizzle-orm bumped repo-wide to ^0.45.2 for
      its peer range.)*
- [x] Enable **both** Google OAuth *and* email/password. *(email/password always on; Google
      wired but only registered when `GOOGLE_CLIENT_ID`/`_SECRET` are present — `env.ts`
      defaults everything for `make dev`, prod guard throws on missing injected secrets.)*
- [ ] Google Cloud Console: OAuth client, consent screen → **Production**, scopes limited to
      `openid`/`email`/`profile`. Register both redirect URIs:
      `http://localhost:3000/...` and `https://api.<domain>/...`. *(deferred — needs the
      Google project + the deployed hostname; email/password unblocks everything else.)*
- [x] **`GATE`** — `GET /api/auth/jwks` returns public keys. *(pass, local 2026-09-07:
      `{"keys":[{"alg":"EdDSA","crv":"Ed25519",...}]}`. sign-up/sign-in return
      `set-auth-token`; `GET /api/auth/token` with the bearer returns a valid EdDSA JWT
      whose `kid` matches JWKS, claims `sub`/`email`/`iss`/`aud`.)*
- [x] `@elysiajs/openapi` mounted (already in all 3 services at `/swagger`).
- [x] Compiled Bun binary on distroless — **works in-cluster.** (The earlier "binary won't
      serve" was a local-macOS artifact only; the linux/amd64 image built in Docker runs
      fine — verified 2026-09-07, all 3 services serving on k3d via the Helm chart.)

### DNS and TLS — start early, it propagates slowly

- [ ] Decide Route 53 vs Cloudflare-proxied, using the Day 1 probe result.
- [ ] **Delegate a subdomain only** (`cloud.<domain>`), never the apex.
- [ ] Request the ACM certificate; complete DNS validation.
- [ ] **`GATE`** — `https://api.<domain>` serves your service with a valid certificate.
- [ ] **`GATE`** — Google OAuth completes end-to-end against the deployed URL.

### event service

- [~] CRUD, listing, JWT verification via `jose` `createRemoteJWKSet` against auth's JWKS.
      *(done local 2026-09-07: `GET /api/events`, `GET /api/events/:id`,
      `GET /api/events/:id/summary` (trimmed shape for registration, §4.4),
      `POST /api/events` guarded by `{ auth: true }`. Verification is the shared
      `bearerAuth` Elysia macro in `@eventide/shared/auth` — `jose` local verify vs JWKS,
      no hop to auth, no DB call; `event`+`registration` both reuse it. `event_db` wired via
      `apps/event/src/lib/db.ts`; `/health/ready` does a real `select 1`. E2E verified:
      auth JWT → create event → owner_id = JWT sub; bad/absent token → 401. **S3 presigned
      cover-upload deferred to week 3.**)*
- [~] ESO installed; `ClusterSecretStore`; three `ExternalSecret` resources. *(templated in
      `infra/helm/eventide` — `templates/externalsecrets.yaml`, `eso.enabled` in
      `values.aws.yaml`. ESO operator itself not yet installed on the cluster; on k3d the
      `eventide-<svc>` Secrets are `kubectl create secret` as designed.)*
- [~] **`GATE`** — pods read `process.env.DATABASE_URL` with no AWS SDK call in app code.
      *(app-side true — no `@aws-sdk/*` in `apps/*`, env via `defineEnv(process.env)` only,
      `envFrom` a Secret. Verified on k3d: all 3 services read `DATABASE_URL` from the
      `eventide-<svc>` Secret. Close it on EKS once ESO is installed.)*
- [~] Both services deployed to EKS behind ingress paths. *(Helm chart `infra/helm/eventide`
      — one release, all 3 services + Ingress + HPA + ESO + db-bootstrap Job. **fully
      deployed + E2E-tested on k3d** 2026-09-07. `scripts/k3d-up.sh` rewritten to the chart
      (creates the app Secrets, `bun db:bootstrap`, `helm upgrade`) — **verified**.
      `scripts/deploy.sh` rewritten to `helm upgrade -f values.aws.yaml` (assembles the k8s
      Secrets from `eventide/rds-master`, `eso.enabled=false`) — **not run against EKS yet**.
      ESO path TODO: 20-platform must write real `DATABASE_URL` + `BETTER_AUTH_SECRET` into
      the per-service Secrets Manager secrets each rebuild, then flip `eso.enabled=true`.)*

---

## 4. Week 3 — registration, S3, frontend (21–27 Sep)

### registration service

- [x] Create ticket, list mine, capacity enforced by **counting its own rows** in one local
      transaction. *(done local 2026-09-07: `POST /api/registrations` (auth),
      `GET /api/registrations/me` (auth), `GET /api/registrations/event/:id/count`. Capacity
      transaction serialised per-event with `pg_advisory_xact_lock(hashtextextended(eventId))`
      — verified: 3 concurrent bookings on a cap-1 event → `200 409 409`, final count 1, no
      oversell. Dup booking → 409 `already_registered` (checked before capacity); unique
      `(event_id,user_id)` is the backstop. Reuses the shared `bearerAuth` macro.)*
- [x] Server-side enrichment: `registration` calls `event` in-cluster for titles.
      *(the one hop is at **booking time** — `apps/registration/src/lib/event-client.ts`
      GETs `event`'s `/:id/summary` for `{title, capacity}`, both denormalised onto the
      ticket (§4.3). `/me` then needs no join and no second hop. event down → 502,
      event 404 → 404.)*
- [x] **`GATE`** — connect as `event_svc`, attempt to read `registration_db`, Postgres
      refuses. **PASSED 2026-09-07 on RDS** — a one-off pod as `event_svc`:
      `event_db` → `OK (15 events)`, `registration_db` →
      `permission denied for database "registration_db"`.

### S3 uploads

- [x] Presigned `PUT` endpoint on `event` (`POST /api/events/:id/cover-upload`, auth +
      owner-only) + presigned `GET` in `GET /api/events/:id` (`coverUrl`, 1 h). Key is
      `events/<id>/cover.<ext>`. `apps/event/src/lib/s3.ts` (`@aws-sdk/s3-request-presigner`);
      `s3Enabled` gates the route (501 when no bucket → events just have no image). Unit
      tests verify the sigv4 URL shape + expiry (4 tests). **The app's one AWS touch-point.**
- [x] **Bucket CORS policy.** Already in `10-foundation/s3.tf` — `PUT/GET/HEAD`, `*` headers,
      `ETag` exposed, origins from `uploads_cors_allowed_origins` (`*` for now).
- [x] Frontend: `apps/web/src/pages/CreateEvent.tsx` (`/events/new`, auth) — form + file
      input → create event → presigned PUT → `fetch(uploadUrl, PUT, file)`. Detail page
      shows `coverUrl`. "New event" in the nav. Browser-tested (create flow 3/3; the S3 PUT
      itself needs a live bucket).
- [x] `deploy.sh` injects `S3_BUCKET_NAME` + the session's AWS creds
      (`aws configure export-credentials`) into `eventide-event` — expires each session,
      re-`make deploy` (§5.3).
- [ ] **`GATE`** — upload an image from the browser on the deployed system; bytes never
      touch a pod. *(needs a lab session — presign against the real bucket.)*

### Frontend — **hard cap: 2 days**

- [x] Vite + React 19 + Tailwind **v4** (`@tailwindcss/vite`, `@theme` in `index.css`,
      no config file). `--preset bfEjlVBAI` not run — hand-rolled `button`/`input`/`card`
      in shadcn style instead, so the preset's unknowns don't matter (it can be layered on
      later if it's just theme tokens). `apps/web`, in the Bun workspace + turbo.
- [x] Eden Treaty clients — `edenEvent` + `edenReg` (`@eventide/{event,registration}/app`
      `type App`). **auth uses better-auth's own `createAuthClient`** (+ `jwtClient`), not
      Eden — better-auth owns `/api/auth/*`, Eden only sees the health routes. Deviation
      from the "three Eden clients" line, noted.
- [x] Four screens: event list (`/`), event detail (`/events/:id` — register button),
      login (`/login` — email/password + Google button), my tickets (`/tickets`). Minimal,
      neutral palette.
- [x] Token in `localStorage` (`eventide.bearer` from `set-auth-token`), the JWT fetched
      via `authClient.token()` and cached to ~1 min before expiry, sent to event/
      registration as `Authorization: Bearer` (`lib/eden.ts` `onRequest`).
- [x] Dev parity: Vite proxies `/api/{auth,events,registrations}` → :3000/:3001/:3002, so
      the SPA always talks to its own origin — identical to prod behind one ingress.
- [x] `bun run build` / `check-types` / `lint` green. **Browser E2E verified 2026-09-07**
      (headless Chrome via puppeteer-core, 9/9): list → detail → sign-up → auto sign-in →
      book a seeded event → my tickets → log out, no API 4xx. `apps/web/test/e2e.md`.
      One fix needed: `auth` must `trustedOrigins` the Vite dev origin (`localhost:5173`)
      or better-auth's CSRF check rejects login — set in the auth `dev` script; deployed is
      same-origin so no config.
- [ ] Build → S3 → CloudFront (or Cloudflare, per the Week 2 decision). *(needs lab)*
- [ ] **`GATE`** — deployed SPA completes Google login and books a ticket. *(needs Google
      OAuth client + deploy)*

> If this week slips, **cut the frontend, not the infrastructure.** Swagger is a complete
> demo surface on its own.

---

## 5. Week 4 — scaling, report, rehearsal (28 Sep – 4 Oct)

### Autoscaling

- [~] Resource `requests` and `limits` on all three services — HPA does not work without
      requests. *(`event.yaml` has them: `50m/64Mi` req, `250m/192Mi` lim. `auth` /
      `registration` need the same when their manifests are written.)*
- [~] metrics-server; HPA on `event` (CPU target ~60%, min 2, **max 8**). *(prepped
      2026-09-07: `helm_release.metrics_server` in `20-platform/addons.tf` — chart 3.12.2,
      `--kubelet-insecure-tls`; `infra/k8s/event-hpa.yaml` — `autoscaling/v2`, CPU 60%,
      2→8, fast scale-up / 60s scale-down. `make deploy` applies it with the dir.
      Untested against a live cluster.)*
- [~] CloudWatch Container Insights add-on enabled in Terraform. *(prepped, **gated OFF**:
      `aws_eks_addon.cloudwatch_observability`, `count = var.enable_container_insights ? 1 : 0`.
      Its CloudWatch agent needs `CloudWatchAgentServerPolicy` on the node role via
      `iam:AttachRolePolicy` — still unprobed. Probe commands in `addons.tf`. Fallback:
      `kubectl top pods` + HPA event log.)*
- [~] k6 script against `/api/events`; tune load until replicas visibly climb and settle.
      *(`load/k6/events.js` — ramping-vus 0→50→120→0 over 12 min; `make load BASE_URL=…`;
      `load/README.md` has the watch-pane commands + tuning notes. Not yet run.)*
- [ ] **`GATE`** — replicas go 2 → 8 under load and scale back down afterwards.
- [ ] Screenshot `kubectl get hpa -w`, pod counts, and Container Insights graphs.

> **Do not scale past 8.** A `t3.medium` allows 17 pods (3 ENIs × 6 IPv4); two nodes minus
> system pods leaves ~28. Beyond that, pods sit `Pending` and it looks like a bug.

### Report

- [~] Skeleton written — `docs/REPORT.md` (10 sections, each led by its trade-off + the
      evidence it needs). Fill prose as work lands.
- [ ] Lead with the trade-offs, not the feature list:
  - [ ] Service boundary placed to avoid a distributed transaction
  - [ ] Database-per-service enforced by Postgres, not by convention
  - [ ] Asymmetric JWT via JWKS — other services cannot mint tokens
  - [ ] IRSA unavailable → static credentials, security trade-off documented
  - [ ] NAT gateway avoided → public subnets + security groups, cost-driven
  - [ ] Bearer tokens over cookies → environment parity; XSS exposure stated
  - [ ] CI/CD stops at the image → OIDC federation impossible in the lab
  - [ ] Go evaluated and rejected on delivery risk, not ignorance
  - [ ] Ephemeral infrastructure → $25 actual vs ~$180 if left running
- [ ] Architecture diagram, screenshots, cost table.

### Rehearsals

- [ ] **`GATE`** — Rehearsal 1: destroy, rebuild from zero, run the full demo, **timed**.
- [ ] Fix whatever broke.
- [ ] **`GATE`** — Rehearsal 2: same again, clean.
- [ ] Then stop changing things.

### Demo runsheet

- [~] Written — `docs/DEMO-RUNSHEET.md` (evening-before, pre-flight, 6-step live sequence,
      post-demo, rehearsal checklist + known-failure table). Refine after Rehearsal 1.
- [ ] Start `terraform apply` at the top and talk over it.
- [ ] Show the database boundary being refused by Postgres.
- [ ] Log in with Google, create an event, upload an image, book a ticket.
- [ ] Rotate a secret in Secrets Manager, let ESO sync, restart the pod, keep working.
- [ ] k6 + `kubectl get hpa -w` side by side.
- [ ] Destroy it, on purpose, in front of the room.
- [ ] **Fallback rehearsed:** `kubectl port-forward svc/auth 3000:3000` if DNS or TLS
      misbehaves — Google accepts `localhost`, and it is still the real cluster.

---

## 6. Cut list — in this order, if time runs out

1. Frontend polish → ship shadcn defaults.
2. CloudFront/custom domain → demo via `port-forward` over `localhost`.
3. The whole frontend → demo via Swagger.
4. `registration` service → 2 services still demonstrate an inter-service call.

**Never cut:** Terraform IaC, working EKS deployment, Secrets Manager integration, HPA
autoscaling demo. Those four are what the rubric measures.

---

## 7. Backlog — mention in the report, do not build

- [ ] BFF / API gateway for aggregation
- [ ] Prometheus + Grafana
- [ ] GitHub Actions deploying via OIDC (impossible in this lab)
- [ ] Separate RDS instance per service
- [ ] IRSA instead of static credentials
- [ ] cert-manager + Let's Encrypt
