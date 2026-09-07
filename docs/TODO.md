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
- [ ] Confirm what `shadcn --preset bfEjlVBAI` configures — specifically whether it targets
      Tailwind v3 or v4. A major-version mismatch is the one place this frontend stack
      reliably breaks.

---

## 1. Daily ritual

### Every session start

- [ ] Learner Lab → **Start Lab**. Note the credit remaining.
- [ ] Copy AWS CLI credentials into `~/.aws/credentials` (they expire with the session).
- [ ] `terraform -chdir=infra/terraform/20-platform apply` — ~18 min. Start it, then do
      something else.
- [ ] `aws eks update-kubeconfig --region us-east-1 --name eventide`
- [ ] Refresh the in-cluster AWS credentials Secret (`scripts/lab-creds.sh`) — **unless**
      the `AttachRolePolicy` route worked, in which case this step disappears.
- [ ] Run the migration + seed Job.

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
  - [ ] **Record whether `iam:AttachRolePolicy` succeeded.** If yes, pods get S3 and Secrets
        Manager access from the node role via IMDS, and the per-session credential refresh
        script is never needed.
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
- [~] Kubernetes `Job` that connects as master and creates `auth_db` / `event_db` /
      `registration_db` plus their three users. *(`infra/k8s/db-bootstrap.job.yaml` +
      `packages/db/Dockerfile` + `scripts/db-bootstrap.sh` (`make db-bootstrap`) written &
      validated. `random_password.svc` ×3 + `MASTER_DATABASE_URL` added to the
      `eventide/rds-master` secret. **2026-09-07:** `10-foundation` re-applied → ECR repo
      `eventide/db-bootstrap` now exists. `make up` clean (23 res). Job manifest + secret
      creation from Secrets Manager both work. **BLOCKED: cannot push the image to ECR from
      a VPN** — `docker push` and `buildx --push` both stall on the last ~4 layers (~150 MB
      image; small ECR requests fine, large blob PUTs hang — VPN MSS/MTU). Fixes for next
      session: (a) push off-VPN, or (b) lower OrbStack MTU, or (c) slim the image
      (`oven/bun:1` → `oven/bun:1-slim` in `packages/db/Dockerfile`). Then `make db-bootstrap`
      should run clean.)*
- [ ] **`GATE`** — full `destroy`, then rebuild from zero, end to end. This is the step
      everyone skips. *(deferred with db-bootstrap — do both next session.)*

### Day 5 (Fri) — checkpoint

- [ ] Slides: architecture diagram, the probed lab constraints, what ships in weeks 2–4.
- [ ] Rehearse the live bit: browser hits the URL → `kubectl scale deployment api
      --replicas=5` → `kubectl get pods -w`.
- [ ] **Present.**
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
- [~] Migration path: `packages/db/scripts/bootstrap.ts` now creates **all three** roles +
      DBs and runs `drizzle-kit migrate` for all three (auth_db included). Verified locally:
      `make bootstrap` → 3 DBs migrated clean. **Seed** (~15 events, users) still TODO.
- [ ] **`GATE`** — teardown, rebuild, and the seeded app looks demo-ready with no manual
      steps.

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
- [ ] **Deploy blocker (pre-existing, not auth-specific):** `bun build --compile` binaries
      don't serve on the installed Bun 1.4.0 (Aug build) — `event`'s binary fails the same
      way. `bun src/index.ts` works fine. Fix the Bun toolchain before the distroless
      image path (§12.1) can ship.

### DNS and TLS — start early, it propagates slowly

- [ ] Decide Route 53 vs Cloudflare-proxied, using the Day 1 probe result.
- [ ] **Delegate a subdomain only** (`cloud.<domain>`), never the apex.
- [ ] Request the ACM certificate; complete DNS validation.
- [ ] **`GATE`** — `https://api.<domain>` serves your service with a valid certificate.
- [ ] **`GATE`** — Google OAuth completes end-to-end against the deployed URL.

### event service

- [ ] CRUD, listing, JWT verification via `jose` `createRemoteJWKSet` against auth's JWKS.
- [ ] ESO installed; `ClusterSecretStore`; three `ExternalSecret` resources.
- [ ] **`GATE`** — pods read `process.env.DATABASE_URL` with no AWS SDK call in app code.
- [ ] Both services deployed to EKS behind ingress paths.

---

## 4. Week 3 — registration, S3, frontend (21–27 Sep)

### registration service

- [ ] Create ticket, list mine, capacity enforced by **counting its own rows** in one local
      transaction.
- [ ] Server-side enrichment: `registration` calls `event` in-cluster for titles.
- [ ] **`GATE`** — connect as `event_svc`, attempt to read `registration_db`, Postgres
      refuses. This is a demo moment; verify it works.

### S3 uploads

- [ ] Presigned `PUT` endpoint on `event`; presigned `GET` for display.
- [ ] **Bucket CORS policy.** Budget most of a day — this defeats nearly everyone.
- [ ] **`GATE`** — upload an image from the browser; bytes never touch a pod.

### Frontend — **hard cap: 2 days**

- [ ] Vite + React + Tailwind + shadcn (`--preset bfEjlVBAI`, verify the Tailwind major
      version first).
- [ ] Three Eden Treaty clients: `edenAuth`, `edenEvent`, `edenReg`.
- [ ] Four screens: event list, event detail, login, my tickets. **Deliberately unstyled
      beyond shadcn defaults.**
- [ ] Token in `localStorage`, sent as `Authorization: Bearer`.
- [ ] Build → S3 → CloudFront (or Cloudflare, per the Week 2 decision).
- [ ] **`GATE`** — deployed SPA completes Google login and books a ticket.

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
