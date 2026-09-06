# Project Knowledge Base

Everything decided so far, why it was decided, and what was rejected. Written so that a
teammate — or a fresh AI session — can pick this project up cold without re-deriving
anything.

**Companion document:** [`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) describes *what* is being
built. This file records *why*, and what is still unknown.

**Source:** a design interrogation session on 2026-09-06 that walked the decision tree
question by question, plus a live capability probe of the actual AWS Learner Lab account.

---

## 1. Project context

| | |
|---|---|
| Course | Cloud Computing 2026, IT KMITL |
| Repo | `Cloud_Computing2026-Project` (`~/Project/cloud-project`) |
| Grading | **Both** application and infrastructure, with a written report **and** a live demo |
| Team | 3 nominally; **effectively solo** (Suwijak), AI-assisted |
| Duration | ~4 weeks, with an interim checkpoint in the week of 2026-09-07 |
| Final demo | ~2026-10-02 (estimated; confirm) |
| AWS | Academy Learner Lab, account `735838417080`, `us-east-1`, **$50 hard cap** |

### The governing principle

> **Get a hello-world pod answering HTTP on real EKS before writing a single feature.**

The characteristic failure of a project graded on both app and infrastructure is spending
four weeks on features and demoing a half-deployed cluster. Everything in the plan is
arranged to hit infrastructure risk in week 1, while there is still slack.

### What AI does and does not help with

Genuinely accelerates: Terraform modules, Helm charts, Dockerfiles, CRUD boilerplate, CI
YAML, reading error messages. Realistically ~80% of the typing.

Does **not** help with:

- **Waiting.** `terraform apply` for EKS is 15–20 minutes of wall clock.
- **The live demo.** You will be asked "why did you choose this?" and "what happens if
  this pod dies?" AI-generated infrastructure you do not understand fails exactly there —
  and that is the part being graded.
- **Integration bugs.** The ones that eat days are "service A cannot reach service B and
  the logs say nothing."

**Rule of thumb:** if you cannot sketch the architecture on a whiteboard from memory, you
are not ready to demo it.

---

## 2. Verified environment constraints

Probed live against account `735838417080` on **2026-09-06**. These are API call results,
not assumptions from documentation.

| Capability | Result | Consequence |
|---|---|---|
| EKS API | ✅ Allowed | Versions 1.31–1.36 offered. Target 1.33. |
| `LabEksClusterRole` | ✅ Pre-created | Trusts `eks.amazonaws.com`; EKS Cluster/Networking/Compute/BlockStorage/LoadBalancing policies |
| `LabEksNodeRole` | ✅ Pre-created | Trusts `ec2.amazonaws.com`; CNI + WorkerNode + ECR read |
| RDS, S3, Secrets Manager, ECR, EC2 | ✅ Allowed | No denials on describe/list |
| Default VPC | ✅ Exists | `vpc-07338cd8d3c8022aa`, 6 public subnets, IGW, **no NAT** |
| `iam:CreateRole` | ❌ **Denied** | Terraform must reuse the lab roles |
| `iam:CreateOpenIDConnectProvider` | ❌ **Denied** | **No IRSA. No GitHub Actions OIDC.** |
| `servicequotas:GetServiceQuota` | ❌ Denied | vCPU ceiling unknown — stay small |
| **Route 53 · ACM · CloudFront** | ⚠️ **NOT PROBED** | The entire TLS/custom-domain design (§5.5) depends on these. Run the extended `scripts/check-lab.sh` before building on them |

**The pre-created EKS roles are the decisive finding.** AWS Academy only provisions those
when EKS is an intended, supported service in the lab. The professor set this up expecting
Kubernetes.

### Re-probing

`scripts/check-lab.sh` re-runs these checks. **Run it after any lab reset** — role ARNs and
permissions can change, and they differ in each teammate's account.

### Learner Lab operating facts

- Sessions last **4 hours**; press Start to reset the timer.
- Session credentials (`ASIA…` + session token) **expire with the session**. Never start an
  EKS apply after the third hour.
- At session end the lab **auto-stops EC2 only**. RDS, EKS control plane, ELBs and NAT keep
  billing. The lab documentation says so explicitly.
- **Exceeding $50 locks the account and deletes all work.**
- Teammates hold separate Learner Lab accounts ≈ **$150 combined runway**. This is the
  demo-week fallback, not an excuse for sloppiness. It works only because Terraform looks
  role ARNs up dynamically.

### Security incident, 2026-09-06

Live session credentials were pasted into a chat during this session. They were temporary
STS credentials for a $50 sandbox, and the lab session was rotated afterwards — low
severity. **Habit to keep:** paste script *output*, never `aws_secret_access_key` or
`aws_session_token`. The same reflex on a real account is expensive, and "we leaked
credentials" is a bad line in a cloud computing report.

---

## 3. Decision log

Each row records what was chosen, why, and what was rejected — so that decisions are not
silently re-litigated later.

### Scope

| Decision | Rationale | Rejected |
|---|---|---|
| **Exactly 3 services** | Two demonstrate a service-to-service call; three demonstrate a real topology. More, solo, means several half-finished services and nothing deployed. | 6–8 services (the common student instinct) |
| **Infrastructure before features** | Grading covers both; infrastructure does not compress under deadline pressure, features do. | Build the app first and containerise at the end |
| **Cut Prometheus + Grafana** → CloudWatch Container Insights | 1–2 days of Helm and dashboard work vs. a Terraform add-on, for metrics adequate to screenshot. Biggest time saving for the smallest rubric loss. | Self-hosted monitoring stack |
| **Frontend never on the critical path** | `@elysiajs/swagger` is always a complete demo surface. A beautiful UI over a broken cluster is the exact failure mode being avoided. | Frontend-first |
| **Frontend capped at 2 days**, deliberately unstyled | Four screens prove the services work together. That is its whole job. | Component library, design polish |
| **No BFF / API-gateway service** | A fourth service to deploy and debug for no marks. Named in the report as the next step. | Aggregation gateway |
| **Registration stays thin** | Create ticket, list mine, capacity check. | Waitlists, payments, email, QR codes |

**Must not be cut under any circumstances:** Terraform IaC, a working EKS deployment,
Secrets Manager integration, and the HPA autoscaling demo. Those four are what a cloud
computing rubric actually measures.

### Technology

| Decision | Rationale | Rejected |
|---|---|---|
| **TypeScript** | Existing fluency is the scarcest resource in 4 weeks, and two hard new things (Kubernetes, Terraform) are already being learned. | **Go** — genuinely better here on image size (~15 MB vs ~90 MB) and per-pod memory, which would make a denser autoscaling demo. Loses because it is a third new thing and **no rubric awards marks for Go**. Worth a report paragraph: *"we evaluated Go for smaller images and lower per-pod memory, and chose TypeScript to reduce delivery risk within a 4-week solo timeline."* |
| **ElysiaJS on Bun** | User's explicit preference and existing fluency; `@elysiajs/swagger` generates an interactive API page from route types for free. | **Hono** was recommended for being runtime-agnostic (a real hedge if Bun misbehaves in-cluster); overruled in favour of familiarity. Express, Fastify. |
| **Turborepo monorepo** | Three repos means three CI pipelines and duplicated shared types — so `auth` issues a JWT one shape and `event` parses another, discovered at runtime. Services remain independently deployed containers: sharing a git repo is a *delivery* choice, not an architectural one. | Repo per service |
| **k3d for local Kubernetes** | The same manifests run daily from week one. With Compose, manifests get written late and first exercised on AWS under deadline pressure. | **Docker Compose** — the decisive rejection; kind (equivalent, slightly heavier) |
| **Hybrid dev loop** | `bun --watch` for the ~1 s inner loop, `make k3d` (~30 s) daily for the outer loop. | **Skaffold / Tilt** — at a 30 s outer loop they earn little, and when they misbehave you debug the tool instead of the project |
| **Vite + React + Tailwind + shadcn/ui** | Static bundle, no SSR — the frontend must be a file in S3, not a pod. shadcn is copy-in components, which keeps the 2-day cap realistic. | TanStack Start (SSR would need a container); hand-rolled CSS |
| **Eden Treaty** | End-to-end types from each Elysia server to the SPA with no codegen step. | OpenAPI codegen; hand-written fetch wrappers |
| **better-auth** | Sessions, password hashing and account tables solved in an afternoon rather than a week, and more credible than a hand-rolled JWT flow. | Hand-rolled auth (the original plan) |
| **Elysia `t` / TypeBox for request models** | Best-practice guidance: models are `t.Object` registered via `.model()`, one definition serving validation *and* types. | **Zod for request bodies** — a parallel schema system would break Eden's inference. Zod is retained for boot-time env validation only, outside the request path. |
| **Compiled Bun binary on distroless** (`bun build --compile`, `gcr.io/distroless/base-debian12`) | 2–3× lower runtime memory than running the source → more pods per `t3.medium` (the §10 pod-IP ceiling is the real constraint). Verified: `apps/event` image = 45.8 MB, all routes served. See SYSTEM-DESIGN §12.1 for the libc/arch/AVX2 caveats. | **`oven/bun:1-alpine` running the source** (the original §12.1 plan, ~90 MB) — changed 2026-09-06 during monorepo init for the memory reduction, not image size (roughly the same). |
| **`@elysiajs/openapi` mounted at `/swagger`** | `@elysiajs/swagger` (named in §3.1) is superseded by `@elysiajs/openapi`; same interactive demo surface, maintained package. | — |

### Architecture

| Decision | Rationale | Rejected |
|---|---|---|
| **One RDS instance, database per service** | PostgreSQL **cannot** join across databases — the boundary is enforced by the engine, not by discipline. Makes Secrets Manager load-bearing (3 secrets, one per service) rather than decorative. | Shared tables (the classic anti-pattern); schema-per-service (cross-schema joins remain possible if grants slip); 3 RDS instances (3× cost and provisioning time for identical learning) |
| **Capacity owned by `registration`** | If `event` owned "seats remaining", booking would write to two databases — a distributed transaction needing sagas or 2PC. Owning the ticket rows makes a booking one local transaction. | Capacity in `event` |
| **One frontend for all services** | Microservices is a *backend* pattern. Micro-frontends exist to let many frontend **teams** deploy independently — a problem a solo developer does not have; building one would be cargo-culting. | Micro-frontends (Module Federation, single-spa) |
| **Static SPA on S3 + CloudFront** | The frontend is not a microservice — it is a static bundle needing no pod. Also gives a *second* use of S3 and adds CloudFront to the diagram. | A fourth container in the cluster |
| **better-auth JWT plugin + JWKS** | better-auth defaults to cookie sessions checked against the DB. In this topology that would force `event`/`registration` either to call `auth` per request, or to read `auth_db` — **which the database boundary forbids by construction**. JWKS lets them verify locally with `jose`, no hop and no DB call. Asymmetric keys mean the other services hold only a public key and cannot mint tokens. | Shared HMAC signing key (weaker); per-request session validation hop; reading the session table (forbidden) |
| **Bearer tokens, not cookies** | Forced by a constraint unrelated to auth: an HTTPS SPA on CloudFront cannot call an HTTP NLB — browsers block it as mixed content, and ACM needs a domain the project does not have. The `Authorization` header behaves **identically** in dev (`localhost` → HTTP, allowed) and demo (CloudFront, same origin). Cookies would need `SameSite=None; Secure` in dev and first-party in prod — two configurations to keep alive. | **Option A: everything behind CloudFront** — cleanest security posture (no CORS, `httpOnly` cookies), but CloudFront sits in the persistent layer while the NLB is destroyed nightly and returns with a new DNS name, so the origin needs a ~5-minute update every morning for four weeks |
| **Google OAuth as primary login, email/password kept enabled** | The seed Job cannot create OAuth users — 15 events need owners, and hand-clicking through Google after every nightly rebuild is untenable. Also demo-day resilience: OAuth depends on campus wifi and Google's availability. | OAuth-only |
| **Custom domain (subdomain delegated to Route 53) + ACM** | Google rejects any non-HTTPS redirect URI outside `localhost`, and the NLB's DNS name changes nightly — so a stable HTTPS hostname is mandatory, not cosmetic. Route 53 ALIAS records are managed by Terraform in `20-platform`, so rebuilds re-point DNS automatically with no external API call. Adds two AWS services to the architecture. | **Cloudflare proxied DNS** (simpler, seconds-fast updates, survives an account switch, but adds nothing to an AWS rubric); **cert-manager + Let's Encrypt** (5-duplicate-certs-per-week limit collides with nightly rebuilds) |
| **Consent screen set to Production** | Only `openid`/`email`/`profile` are requested — non-sensitive scopes need no Google verification review. Testing mode restricts sign-in to explicitly added accounts and fails the moment anyone else tries during the demo. | Testing mode |
| **Presigned S3 URLs** | File bytes never touch the cluster, so pod memory stays flat regardless of upload size or concurrency. Proxying on `t3.medium` risks OOMKills that look like crashes mid-demo. | Proxy uploads through the pod |
| **Server-side enrichment** for "my tickets with event names" | One frontend call; the in-cluster hop *is* the inter-service communication the rubric wants. | Browser-side N+1 fan-out |

### Infrastructure

| Decision | Rationale | Rejected |
|---|---|---|
| **Managed node group**, 2 × t3.medium | Cost is exactly predictable, which matters on a hard cap where overspend deletes the project. Standard, heavily documented path. | **EKS Auto Mode** — the lab is provisioned for it (the cluster role carries the Auto Mode policies) and it sidesteps IRSA for load balancing; rejected because Karpenter chooses instance types, and predictability beats convenience when the budget is a kill switch |
| **No VPC module — use the default VPC** | Removes the NAT gateway ($1.08/day, and the most common cause of failed teardown) and ~3 min from every apply and destroy. Discovered during the probe. | Purpose-built VPC with private subnets + NAT |
| **Pin to us-east-1a/b/c** | `us-east-1e` routinely lacks capacity for modern instance types and fails node groups with an opaque error. | All six AZs |
| **ingress-nginx as NodePort + Terraform-managed NLB** | Solves two problems at once: no in-cluster AWS credentials needed, **and** the LB is in Terraform state, so `destroy` does not orphan it. | `Service type=LoadBalancer` (the ELB is invisible to Terraform); AWS Load Balancer Controller (needs IRSA) |
| **External Secrets Operator** | The app reads `process.env` only — identical code and manifests on k3d and EKS, zero conditionals. | SDK `GetSecretValue` at boot; Secrets Store CSI driver — both need IRSA and leak AWS into local dev |
| **Terraform split by lifetime** | Foundation (~$1/mo) never destroyed, so images/uploads/secrets survive. Only the ~$180/mo platform layer is disposable. | One root module; splitting by resource type |
| **S3 native state locking** (`use_lockfile = true`) | Terraform 1.10+ removed the need for a DynamoDB lock table. | DynamoDB lock table |
| **Destroy every session** | Not primarily for money — for **repetition**. Twenty rebuilds from zero before demo day is what makes a live demo safe. | Leave it running (~$180/mo, exhausts $50 in ~15 days) |
| **CI builds only; deploy is local** | GitHub Actions OIDC needs an IAM provider that cannot be created, and static lab credentials expire in 4 hours. | Automated CD to EKS |

---

## 4. Traps, with their fixes

Each of these has ended a student project or a demo.

| Trap | Fix |
|---|---|
| **Orphaned ELB blocks `terraform destroy`** — Kubernetes-created LBs are not in state, so destroy hangs ~20 min on the VPC and fails. You believe you tore down; you did not. | `kubectl delete ingress --all` **before** destroy; keep the NLB in Terraform; verify with `aws elbv2 describe-load-balancers` |
| **ASG relaunches lab-stopped nodes** — the lab auto-stops EC2, the ASG sees "unhealthy" and replaces them, quietly burning budget | Never rely on auto-stop; always run a verified teardown |
| **Hardcoded lab role ARNs** — the `c219141a…` prefix changes on reset and differs per account | `data "aws_iam_roles"` with `name_regex` |
| **Liveness probe that checks the DB** — a 5-second RDS blip restarts every pod at once, turning a hiccup into an outage | `/health/live` must not touch the database; only `/health/ready` does |
| **Bun ignoring `SIGTERM`** — every rolling update drops in-flight requests and waits the full grace period, visibly, during a scaling demo | `process.on("SIGTERM", () => server.stop())` |
| **Pod IP ceiling** — `t3.medium` allows only 17 pods (3 ENIs × 6 IPv4); beyond it pods sit `Pending` with an error that reads like a bug | Scale the HPA to 8 replicas, not 80 |
| **S3 CORS** — browser `PUT` to a presigned URL fails with no useful error | Bucket CORS policy; budget most of a day |
| **Session expiry mid-apply** — `ExpiredToken` partway through a 20-minute EKS apply | Never start an apply after hour 3; press Start to reset first |
| **k3s ships Traefik** — different ingress locally than on EKS, so manifests do not port | `--k3s-arg "--disable=traefik@server:*"`, install ingress-nginx in both |
| **RDS destroy fails** | `skip_final_snapshot = true`, `deletion_protection = false` |
| **Mixed content kills the demo** — an HTTPS SPA cannot call an HTTP API; the browser blocks it with no server-side trace | Bearer tokens + CloudFront proxying `/api/*` for the demo; never test the deployed SPA against a bare NLB over HTTPS |
| **A broken Elysia method chain silently degrades Eden types to `any`** — no error anywhere, and the frontend loses all type safety | Keep every route definition in one unbroken chain; treat a sudden `any` in the SPA as a chain break, not a client bug |
| **better-auth ids are `text`, not `uuid`** | `event_db.owner_id` and `registration_db.user_id` must be `text`. Mismatched id types across services is a slow, confusing bug |
| **Zod and TypeBox both used for request bodies** | Request models are Elysia `t.Object` only. Zod is confined to boot-time env validation |
| **Zod 4 deprecated the string-format *methods*** — `z.string().url()` / `.email()` / `.uuid()` / `.datetime()` are deprecated and the editor flags them | Use the top-level format schemas: `z.url()`, `z.email()`, `z.uuid()`. `z.coerce.number()` is still current. For a `postgres://` DSN use plain `z.string()` — a URL check there gives false negatives across environments |
| **Google rejects the NLB as a redirect URI** — non-HTTPS URIs outside `localhost` cannot even be saved in the console | Custom domain + TLS (§5.5). Never attempt OAuth against the bare NLB |
| **Consent screen left in Testing mode** — anyone not on the test-user list is flatly refused mid-demo | Publish to Production; non-sensitive scopes need no verification |
| **Delegating the domain apex to Route 53** — breaks any existing production use of the domain, and reverting means re-delegating a live zone | Delegate a **subdomain** only; the fallback is then deleting four NS records |
| **Route 53 zone lives in the Learner Lab account** — falling back to a teammate's account means recreating it, with new NS records and propagation delay | Do the delegation once, early in week 2; keep Cloudflare-proxied DNS as the documented escape hatch |
| **Broken pod egress surfaces as an OAuth timeout**, which looks nothing like a networking fault | Verify `curl https://accounts.google.com` from inside a pod in week 1 |
| **Nightly destroy loses all data** | Migrations **and** seed must be a fully automated Kubernetes Job producing demo-quality data — it runs every morning |

---

## 5. Report talking points

The report is graded alongside the demo. These are the paragraphs where naming a trade-off
scores better than the alternative implementation would have.

1. **Service boundary placed to avoid a distributed transaction** — capacity lives with
   the ticket rows, so booking is one local transaction rather than a saga.
2. **Logical database-per-service on a shared instance**, with a documented migration path
   to physical isolation if a service outgrows it.
3. **IRSA was unavailable in our environment**; static credential injection was used
   instead, and the security trade-off is documented. Pods reading node credentials via
   IMDS is something you would *block* in production.
4. **NAT gateway deliberately avoided** — public subnets with security-group isolation, a
   cost-driven trade-off in a $50-capped environment.
5. **CI/CD stops at the image** — OIDC federation is impossible here; in an unrestricted
   account the same pipeline would assume a role and deploy automatically.
6. **Go was evaluated and rejected** for delivery-risk reasons, not ignorance.
7. **Monorepo for development velocity, independently deployed containers at runtime** —
   naming the distinction between delivery and architecture.
8. **Cost optimisation through ephemeral infrastructure** — with the real numbers:
   $0.27/hr up, $3.40/day idle, ~$25 total versus ~$180.
9. **Asymmetric JWT verification via JWKS** — `event` and `registration` hold only a public
   key and are cryptographically incapable of minting a token. The database boundary made
   the naive alternatives impossible, which is worth showing as a constraint that
   *improved* the design.
10. **Bearer tokens over `httpOnly` cookies** — chosen for environment parity under a
    no-TLS-on-the-load-balancer constraint; the `localStorage`/XSS exposure is stated, not
    hidden.
11. **Build-time type coupling, zero runtime coupling** — Eden gives the SPA end-to-end
    types across three services while the deployed containers stay fully independent.

---

## 6. Open questions

These block nothing today, but two of them could invalidate scope decisions.

1. **The assignment brief has never been seen.** An image was attached three times and
   never reached the assistant. Every scope decision — three services, cutting Prometheus,
   frontend priority — rests on inference about what is graded. **If the rubric explicitly
   names Prometheus, or mandates more services, those decisions flip.** Paste the
   requirements as *text*.
2. **The exact checkpoint date and its requirements** — proposal, design presentation, or
   working code? The Week 1 schedule assumes a Friday checkpoint and a Monday start.
   *Even if it only requires slides, build the EKS hello-world anyway:* the deck takes two
   hours, the Kubernetes learning curve takes four days, and only one of those can be
   deferred.
3. **Is `iam:AttachRolePolicy` permitted?** Untested — only `CreateRole` was proven denied,
   and it is a different action. If allowed, attach S3 and Secrets Manager policies to
   `LabEksNodeRole` and every pod gets credentials via IMDS with no configuration and no
   expiry, deleting the per-session refresh script. **Build against static credentials
   regardless** — this is a 20-minute simplification, not a blocker.
4. **What do the other two teammates actually do?** The plan assumes solo delivery. If
   either becomes available, the frontend and the report are the most separable pieces.
5. **Final demo date** — assumed early October.
6. **What does `shadcn --preset bfEjlVBAI` configure?** Chosen by the user; its contents are
   unverified here. If it pins a theme or component registry, confirm it agrees with the
   installed Tailwind major version — a Tailwind v3/v4 mismatch is the one place this
   frontend stack reliably breaks.

---

## 7. Immediate next actions

1. Rotate the lab session (End Lab → Start Lab).
2. Set an AWS Budgets alarm at **$10**.
3. Run `scripts/check-lab.sh`; add the `iam:AttachRolePolicy` test.
4. `brew install awscli terraform helm k3d` — only `kubectl`, `docker` and `bun` are
   currently installed on this machine.
5. Write `scripts/teardown.sh` **before** there is anything to tear down.
6. Bootstrap the Terraform state bucket, write `10-foundation`, apply.
7. Start on `20-platform`. **Expect the first two applies to fail — that is the plan
   working, not the plan breaking.**
