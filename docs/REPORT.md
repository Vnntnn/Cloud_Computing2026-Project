# Eventide — Cloud Computing 2026 Project Report

> **Draft — near complete.** Every section has real prose and real numbers; the
> only `⟨…⟩` left is the final Learner-Lab credit figure (§8), read from the meter
> at the end of the term. Companions:
> [`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) (what), [`PROJECT-KNOWLEDGE-BASE.md`](./PROJECT-KNOWLEDGE-BASE.md)
> (why + decision log), [`TODO.md`](./TODO.md) (build state).
>
> Every section leads with the trade-off. Naming a rejected alternative and the
> reason scores better than the alternative would have.

---

## 1. Overview

Eventide is an event ticket-commerce platform: browse events, apply to become an
organizer, publish events with ticket types, reserve tickets under an 8-minute
hold, pay through a mock gateway, receive a signed QR ticket, and get checked in
at the door — with attendee / organizer / admin roles and an audit trail.

The **infrastructure** was built first and deliberately kept minimal; once every
infrastructure GATE passed on real EKS, the **application** was expanded from a
thin MVP into this end-to-end flow (the "Full-System V2" design). The topology
did not change — one more service, one more logical database on the same RDS
instance.

The target environment is an **AWS Academy Learner Lab** account with a **$50
hard cap** and four-hour credential sessions. That single constraint shapes most
of the design: infrastructure that cannot be paused is destroyed and rebuilt
every session, and every "why not the obvious approach" answer below traces back
to a permission the lab denies.

**Built:** four independently deployed Elysia/Bun microservices (`auth`, `event`,
`registration`, `payment`) on Amazon EKS, one static React SPA (TanStack Router /
Query / Form + shadcn/ui) served from inside the same cluster, backed by one RDS
PostgreSQL instance with one database per service, plus a per-minute
reservation-expiry CronJob.

| AWS service | Where it is used |
|---|---|
| EKS | Runs the four services + the SPA pod + the expiry CronJob, one managed node group (2 × `t3.small`, k8s 1.33). |
| RDS PostgreSQL | One `db.t3.micro`, **four** isolated databases (`auth_db`, `event_db`, `registration_db`, `payment_db`). |
| S3 | Terraform state; event image uploads (presigned). |
| Secrets Manager | Per-service DB credentials, the better-auth key-encryption secret, the internal service-to-service token, the ticket-signing secret. |
| ECR | Five service images + a db-bootstrap tool image. |
| ELB (NLB) | Public entry point, Terraform-managed, forwards to ingress-nginx. |
| CloudWatch | Container Insights for the autoscaling evidence *(if `iam:AttachRolePolicy` permits — see §7)*. |

## 2. Scope, and what was deliberately cut

**Caveat, stated plainly:** the assignment brief was never available as text.
Every scope decision — the service count, cutting Prometheus, the frontend
priority — is inference about what is graded. If the rubric named something below
as required, that is a gap; it is called out here rather than left for a marker
to find.

Deliberately **not** built, each with its reason (`PROJECT-KNOWLEDGE-BASE.md`
§3, §7):

| Cut | Why | Named in the report as |
|---|---|---|
| BFF / API-gateway service | A fifth service to deploy and debug for no extra marks. | The pattern at scale. |
| Prometheus + Grafana | 1–2 days of Helm values and dashboards for metrics Container Insights already gives. | A richer-observability next step. |
| Separate RDS per service | 4× cost and provisioning time for identical pedagogical value. | The physical-isolation migration path — starting with `payment_db` and the high-write `registration_db`. |
| **A real payment gateway** | The `payment → registration` boundary and the compensating transaction are the point; a Stripe/Omise integration adds none of that reasoning. | The mock replaced by a real provider + signed webhooks. |
| Waiting room / waitlists / Redis seat locks / SQS/EventBridge / mail worker | Each is real-product infrastructure that adds operational surface without new architectural lessons. A sold-out event returns `409 capacity_full` with no queue. | The "Deferred Real-Product Checklist". |
| GitHub Actions OIDC deploy | `iam:CreateOpenIDConnectProvider` is denied — federation is impossible here. | What CI would do in an unrestricted account. |
| cert-manager / Let's Encrypt | 5 duplicate certs per week — nightly rebuilds exhaust the quota in five days. | Viable only with a staging issuer. |
| CloudFront in front of the SPA | `cloudfront:*` denied in the lab (probed 2026-09-07). | Replaced by serving the SPA from the cluster (§5). |

## 3. Architecture

```
                    Browser (React SPA — TanStack + shadcn)
                            │  one origin: https://events.<domain>  (Route 53 + ACM at the NLB, §6)
                            ▼
                 Network Load Balancer  (aws_lb, Terraform)
                            │  TCP :80/:443 → NodePort 30080/30443
┌───────────────────────────┼──────────────────────────────────────────────────────┐
│ EKS 1.33 · 2×t3.small · default-VPC public subnets (us-east-1a/b/c)               │
│                           ▼                                                       │
│                     ingress-nginx  (NodePort, longest-prefix routing)             │
│   /   /api/auth  /api/users  /api/events  /api/categories  /api/orders  /api/payments
│  [web]  /api/admin/*         /api/venues  /api/ticket-types /api/tickets           │
│         [auth]               /api/organizer/* /api/admin/events  /api/check-ins    │
│           │                     [event]              [registration] ──► [payment]  │
│           │                        ▲                     │   ▲   internal (token)  │
│           │        internal checkout-summary ────────────┘   └── confirm/refund ──┘
│           │        + JWKS: event / registration / payment verify JWTs locally      │
│           ▼            ▼                  ▼                    ▼                     │
│        auth_db      event_db       registration_db        payment_db               │
│           └────────────  one RDS db.t3.micro  ──────────────────┘                   │
│   + a per-minute reservation-expiry CronJob (concurrencyPolicy: Forbid)            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Request path.** One public NLB → ingress-nginx (a NodePort Service) →
Service → pod. The SPA and all four APIs sit behind **one origin** so there is
no CORS configuration and no mixed-content problem. ingress-nginx routes by
longest-matching prefix, which is how `/api/admin/users` reaches `auth` while
`/api/admin/events` reaches `event`.

**The four services.**

- **auth** mounts *better-auth* (Drizzle adapter + JWT + bearer + **admin**
  plugins). Email/password and Google OAuth. Roles (`attendee`/`organizer`/
  `admin`), organizer approval, ban, and a `user_audit_logs` trail. Owns
  `auth_db`. Exposes `GET /api/auth/jwks`; the JWT carries `role` and
  `organizerApprovalStatus`.
- **event** — categories, venues, events with a DRAFT→PUBLISHED→CLOSED/SUSPENDED
  lifecycle, ticket types, event images (S3 presigned upload). Owns `event_db`.
  Verifies callers' JWTs locally (§6). Exposes an internal `checkout-summary`
  endpoint (token-guarded) for `registration`.
- **registration** — ticket inventory, orders with 8-minute holds, **capacity
  enforcement** (per-ticket-type advisory lock + a DB CHECK), signed QR tickets,
  check-in. Owns `registration_db`. Calls `event` once at order time.
- **payment** — a **mock** gateway. Owns `payment_db`. Takes an order ID + an
  idempotency key (no card fields), pulls the trusted amount from
  `registration`, records the payment, and calls `registration` to confirm the
  order. Handles the payment-succeeded-but-confirm-failed case with an idempotent
  reconcile (§3 trade-off 2).

### Trade-offs

1. **The service boundary is placed to avoid a distributed transaction.**
   Capacity could belong to `event` ("seats remaining"), but then reserving a
   ticket writes to two databases — a saga or two-phase commit. Instead
   `registration` owns the `ticket_inventory` rows and reserves inside one local
   transaction, serialised per **ticket type** with a transaction-scoped advisory
   lock, with a database CHECK as the backstop:

   ```
   BEGIN;
     SELECT pg_advisory_xact_lock(hashtextextended($ticket_type_id, 0));
     INSERT INTO ticket_inventory (...) ON CONFLICT DO NOTHING;
     -- reserved_count + sold_count + $qty > total_quota ?  -> 409 capacity_full
     UPDATE ticket_inventory SET reserved_count = reserved_count + $qty ...;
     INSERT INTO orders (..., expires_at = now() + interval '8 minutes');
   COMMIT;
   -- CHECK (reserved_count + sold_count <= total_quota)  rejects an oversell even if the code is wrong
   ```

   A reservation is a **hold**: payment confirmation moves `reserved → sold` and
   issues the tickets; expiry (the CronJob), cancellation or refund releases it.
   `event` stays the source of truth for the quota *number*, read once at order
   time. **Automated test: `total_quota + 6` concurrent orders for the last unit
   return exactly `total_quota` × 200 and the rest × 409; `reserved_count` never
   exceeds the quota.** A repeated `Idempotency-Key` (a double-clicked "Buy")
   yields one order, proven by a concurrent test after a real bug was found and
   fixed (the pre-transaction replay check raced the key insert).

2. **The payment flow is a compensating transaction, not a saga framework.**
   `payment` takes payment, then calls `registration`'s internal `confirm`. If
   `confirm` fails after payment succeeded — the classic dual-write problem — the
   payment and order both become `PENDING_VERIFICATION` and an **idempotent
   reconcile** (`POST /api/payments/:id/reconcile`, admin or automatic retry)
   re-runs the confirm. The payment is never taken twice; the reconcile is a
   no-op once the order is `CONFIRMED`. `payment` reads the amount from
   `registration`, never from the browser. **Automated test covers the
   failure-then-reconcile path and asserts a single payment row.**

3. **Logical database-per-service on one instance.** PostgreSQL *cannot* join
   across databases — the boundary is engine-enforced, not a convention that
   depends on grants staying correct. A `schema.test.ts` case asserts zero
   cross-database foreign keys and `text` (never `uuid`) IDs across boundaries.
   Documented migration path to physical isolation. Consequence accepted: no
   cross-service foreign keys or joins.

4. **Asymmetric JWT via JWKS, authorization in the token.** `auth` mints EdDSA
   JWTs and publishes only the public keys at `/api/auth/jwks`. `event`,
   `registration` and `payment` fetch those keys with `jose` and verify locally
   — no per-request hop to `auth`, no database call. They hold only a public key
   and are **cryptographically incapable of minting a token**. The JWT carries
   `role` and `organizerApprovalStatus`, so authorization is also local; a role
   or ban change deletes the user's `session` rows so a stale token cannot
   outlive the change past its short expiry. The database boundary ruled out the
   naive alternatives (call `auth` every request; read its session table) — a
   constraint that *improved* the design.

5. **Monorepo for development, independent containers at runtime.** One
   Turborepo, shared types — but five separately built images, separate
   Deployments, separate scaling. Delivery convenience, not architectural
   coupling.

6. **Build-time type coupling, zero runtime coupling.** Eden Treaty gives the
   SPA end-to-end types from each Elysia server with no codegen step; the
   deployed containers never import each other.

## 4. Infrastructure as Code

All infrastructure is Terraform, **split by lifetime**:

| Layer | Contents | Lifecycle |
|---|---|---|
| `00-bootstrap` | S3 state bucket | created once, by hand (chicken-and-egg) |
| `10-foundation` | ECR repos + lifecycle (5 services + a tool image), Secrets Manager secrets (one per service), uploads S3 bucket | applied once, **never destroyed** |
| `20-platform` | EKS + node group + addons, RDS, NLB, ingress-nginx, metrics-server | **destroyed and rebuilt every session** |

**Raw `aws_eks_cluster` + `aws_eks_node_group`, not `terraform-aws-modules/eks`.**
Every version of the community module reads `data "aws_iam_session_context"`
against the caller, which calls `iam:GetRole` on the `voclabs` session role —
explicitly denied by the lab policy `Pvoclabs2`. There is no module flag to skip
that data source (checked v19–v21). The native
`access_config.bootstrap_cluster_creator_admin_permissions = true` resolves the
creating principal *server-side inside the EKS API* with zero client IAM reads.
Hand-writing the two resources for a lab cluster is ~50 lines — the module's
"week of work" estimate is for a production cluster.

**No `iam:CreateRole`.** Terraform reuses the lab's pre-created
`LabEksClusterRole` / `LabEksNodeRole`, looked up with `data "aws_iam_roles"` +
`name_regex` — never hardcoded, because the role-name prefix changes on every
lab reset and differs per teammate account.

**Every S3 bucket is CLI-created and consumed as `data "aws_s3_bucket"`.** An
org SCP denies `s3:GetBucketObjectLockConfiguration`, which a managed
`aws_s3_bucket` resource reads on every plan — so a managed bucket fails every
refresh. All bucket configuration still lives in Terraform, in the granular
`aws_s3_bucket_*` resources.

**State:** S3 backend with native lockfile (`use_lockfile`), no DynamoDB table.

**Evidence:** `terraform apply` on `20-platform` creates **25 resources** from
nothing (measured 2026-09-07); `terraform state list`; and the teardown sweep
(§8) coming back empty on every check. A full destroy→rebuild that session:
**`make down` 8m56s** (25 destroyed, sweep clean), **`make up` 16m37s** from
zero, then `db-bootstrap` (11s), `helm upgrade` (4 services rolled out),
in-cluster seed, and the full app flow + the cross-DB boundary refusal — all
green through the freshly-created NLB.

## 5. Kubernetes & deployment

**One Helm chart, one release** (`infra/helm/eventide`) that ranges over the five
service Deployments (`auth`, `event`, `registration`, `payment`, `web`) plus the
reservation-expiry CronJob and the db-bootstrap Job. `values.yaml` and the
`values.local.yaml` k3d overlay differ only in image registry, replica count, the
public URL, and whether the HPA is on. The Deployments and HPAs are independent;
one release just gives a single `helm upgrade` and one revision history.

**ingress-nginx as a NodePort Service + a Terraform-created NLB**, not
`Service type=LoadBalancer`. A `type=LoadBalancer` Service makes its own ELB
that Terraform state never sees — it orphans on `terraform destroy` and keeps
billing against the $50 cap. The NLB here is `aws_lb` + two target groups +
`aws_autoscaling_attachment` to the node group, so `destroy` removes it.

**The SPA is served from the cluster.** CloudFront is denied in the lab, and a
second EKS cluster just to host static files would double the un-pausable
$0.10/hr control-plane cost. Instead a 22 MB `nginx-unprivileged` image serves
the built bundle behind the same ingress — the `/` path — with `/api/*` winning
by longest-prefix match. This is what gives the single origin in §3.

**Images.** The four services compile to a single Bun binary
(`bun build --compile`) on `gcr.io/distroless/base-debian12:nonroot` — ~44 MB
each, 2–3× lower runtime memory than running the source, which is what lets more
pods fit under the CNI IP ceiling (§7). `registration`'s image also carries an
`expire` binary run by the CronJob. The `db-bootstrap` migration image is a
focused install (postgres + drizzle-orm + drizzle-kit only, not the monorepo
lockfile) — 89 MB, down from 185 MB. `web` is a ~22 MB `nginx-unprivileged`
image serving the Vite build.

**Local parity.** A k3d cluster runs the **same Helm chart** with the local
overlay. Verified end-to-end: sign in → JWT → publish an event → reserve → mock
pay → order CONFIRMED → QR ticket → check-in — identical to EKS.

**CI/CD stops at the image, but tests the guarantees.** No OIDC federation is
possible (§2), so `.github/workflows/ci.yml` builds, type-checks and tests only.
The `check` job runs `lint / check-types / test / build` against a real
`postgres:16` service (the transaction tests — concurrent oversell, idempotent
order + payment, hold expiry, payment reconciliation, QR-scan outcomes,
ban/session-revocation — need a database), and a second `e2e` job boots the four
services and runs `scripts/smoke.ts`, a 27-assertion persona walk (organizer
publishes → attendee buys and pays → sold-out 409 → check-in SUCCESS then
DUPLICATE → admin suspends + bans, audit and payment views reflect it).
`scripts/deploy.sh` does the deploy locally with fresh session credentials:
build → push to ECR → `helm upgrade` → `rollout status`. In an unrestricted
account the same steps run in CI against an assumed role.

## 6. Security & secrets

**IRSA is unavailable** — `iam:CreateOpenIDConnectProvider` is denied, so IAM
Roles for Service Accounts cannot be used. `iam:AttachRolePolicy` is **also
denied** (probed 2026-09-07), so pods cannot get credentials from the node role
either. The app is therefore built to need **no AWS credentials at all**: it
only ever reads `process.env`. On EKS the `eventide-<svc>` Kubernetes Secrets
are assembled by `scripts/deploy.sh` from the Terraform-managed
`eventide/rds-master` secret; on k3d the same Secrets come from `kubectl create
secret`. Same manifests, same code. **The External Secrets Operator was
evaluated and shelved** (SYSTEM-DESIGN §5.2.1): with no IRSA and no
Secrets-Manager access on the node role, its `ClusterSecretStore` would need a
`secretRef` to static session credentials that expire every session and must be
refreshed by a deploy anyway — more moving parts than the deploy script doing
`kubectl create secret` itself. The ESO templates stay in the chart behind
`eso.enabled` for a non-lab environment.

> **Report note.** Having a deploy script hold the assembled `DATABASE_URL`
> briefly is weaker than IRSA. In production you would use IRSA or Pod Identity
> and never materialise the URL outside the pod. This is a documented workaround
> for a locked-down lab, not a recommendation.

**Asymmetric JWT** (§3, trade-off 3) — the strongest part of the auth design,
and it exists *because* the database boundary forbade the easy options.

**Bearer tokens, never cookies.** The SPA sends `Authorization: Bearer <jwt>`.
A cookie would need `SameSite=None; Secure` in one environment and first-party
in another — two configurations to keep alive — and behaves identically in dev
(`localhost` over HTTP, which browsers and Google both permit) and deployed. The
token in `localStorage` is readable by XSS where an `httpOnly` cookie is not;
this is stated, not hidden, and is the price of environment parity.

**Network posture.** Nodes and RDS sit in the **default VPC's public subnets**,
deliberately — to avoid a NAT gateway ($0.045/hr + data, and the lab budget does
not allow it). Isolation is by security group: the RDS SG admits port 5432 only
from the node security group, and RDS is not publicly accessible. Pod egress to
the internet (needed for Google OAuth) goes through the internet gateway — no
NAT — verified with `curl https://accounts.google.com` from a pod (`302`).

**TLS.** CloudFront is denied and cert-manager's Let's Encrypt quota (5 duplicate
certs/week) is exhausted by nightly rebuilds. The design is **a subdomain
delegated to Route 53 + an ACM wildcard cert, TLS terminated at the NLB**
(SYSTEM-DESIGN §5.5.1 option 2). The hosted zone and cert live in the permanent
Terraform layer so the Cloudflare NS delegation is set once; `20-platform` gives
the NLB a `:443` TLS listener and re-points an `ALIAS` record at the fresh NLB
every rebuild — no external API call per session. Cloudflare-proxied DNS in front
of the NLB is the documented fallback. *(IaC written; applied once the domain is
delegated. Until then the demo runs over `http://<nlb>` or a `kubectl
port-forward` for the Google-OAuth step.)*

**Incident.** Live lab credentials were pasted into a chat on 2026-09-06; the
session was rotated immediately afterward. Noted because the process fix — never
paste `aws_secret_access_key` / `aws_session_token`, only script *output* —
matters more than the one-time exposure.

## 7. Observability & autoscaling

`metrics-server` is installed by Terraform (`helm_release` in `20-platform`) and
feeds a **HorizontalPodAutoscaler on `event`**: CPU target 60 %, min 2,
**max 8**.

**The ceiling is 8 for a reason.** The VPC CNI turns a node's ENI/IP budget into
a per-node pod limit — ~11 on a `t3.small`, ~17 on a `t3.medium`. The load test
was run on **`t3.medium`** (`-var node_instance_type=t3.medium`) so all 8 `event`
replicas plus the other services fit; on `t3.small` the last few would sit
`Pending` with an IP-exhaustion error that reads like a bug, not a limit. Either
way the HPA `maxReplicas` encodes the infrastructure constraint.

**CloudWatch Container Insights** is a Terraform add-on
(`amazon-cloudwatch-observability`), **gated off by default**: its agent needs
`CloudWatchAgentServerPolicy` on the node role, and `iam:AttachRolePolicy` is
denied (§6). Fallback evidence for the report is `kubectl top pods` plus the HPA
event log — which is sufficient to show the scale-up/down.

**Load test.** `load/k6/events.js` — a ramping-VU profile against
`GET /api/events` (0 → 80 → 200 → 0 over ~10 minutes) with thresholds on error
rate and p95 latency.

**Result (2026-09-07, on the deployed system).** k6 drove **98,500 requests at
226 req/s**; p95 latency **431 ms**, **0.10 %** failed (a few timeouts at peak) —
both thresholds green, so the story is "it scaled", not "it fell over".

The HPA followed:

| time | CPU vs 60 % | replicas | HPA event |
|---|---:|---:|---|
| 12:38:53 | 13 % | 2 | — |
| 12:39:05 | 69 % | 3 | `New size: 3; cpu above target` |
| 12:39:16 | 69 % | 5 | `New size: 5` |
| 12:39:40 | 122 % | 7 | `New size: 7` |
| 12:40:03 | 88 % | **8** | `New size: 8` |
| 12:40–12:45 | 86–146 % | 8 | held at max |
| 12:46:04 | 11 % | 8 | load gone |
| 12:46:51 | 4 % | 6 | `New size: 6; All metrics below target` |
| 12:47:25 | 4 % | 4 | `New size: 4` |
| 12:47:48 | 5 % | **2** | `New size: 2` |

**2 → 8 in ~70 s** (0 s scale-up stabilisation), held for the load, **8 → 2 over
~60 s** starting one stabilisation window after the load stopped. Node CPU peaked
at ~12 % — the `t3.medium` had headroom to spare, and no pod went `Pending`.
`kubectl top pods` at peak showed ~40 m CPU per `event` pod (target is 30 m =
60 % of the 50 m request).

## 8. Cost

| Resource | Per hour | Per day if left running |
|---|---:|---:|
| EKS control plane (**delete-only — cannot be stopped**) | $0.100 | $2.40 |
| 2 × `t3.small` on-demand | $0.042 | *(lab auto-stops EC2; the ASG relaunches)* |
| Network Load Balancer | $0.023 | $0.55 |
| RDS `db.t3.micro` (**the lab does not stop RDS**) | $0.018 | $0.43 |
| NAT gateway | **$0.000** | avoided by design |
| **Total, up** | **≈ $0.27 / hr** | **≈ $3.40 / day idle** |

- A four-hour working session costs **≈ $1.10**. Across the term this is on
  track for **≈ $25** actual (⟨fill the final figure from the Learner Lab credit
  meter⟩), against **≈ $180** if `20-platform` were left running.
- Leaving the platform layer up between sessions exhausts $50 in **~15 days** —
  before the demo.
- **Cost optimisation through ephemeral infrastructure**, with a real secondary
  benefit: the stack is rebuilt from zero every working session (twice in the
  2026-09-07 session alone — see §4), so the Terraform is genuinely exercised,
  not written once and hoped over.

### Teardown

`scripts/teardown.sh` deletes Ingress objects (any LB Kubernetes made outside
Terraform), runs `terraform destroy` on `20-platform`, then **proves it** —
`aws eks list-clusters`, `describe-db-instances`, `describe-load-balancers`,
running-instance query, target groups — every check must return empty.
`10-foundation` (ECR/S3/Secrets) is intentionally left intact.

## 9. What we would do differently

- **IRSA / Pod Identity** instead of a deploy script assembling `DATABASE_URL`.
- **GitHub Actions deploying via OIDC** — the same pipeline, federated.
- **BFF / API-gateway** for response aggregation once the client fan-out grows.
- **Prometheus + Grafana** for dashboards beyond Container Insights.
- **Per-service RDS** if one database outgrows the shared instance.
- **Go was evaluated and rejected** — it would give ~15 MB images and a denser
  autoscaling demo, but it was a third new thing (alongside Kubernetes and
  Terraform) in a four-week solo timeline, and no rubric awards marks for the
  language. Delivery risk, not ignorance.

## 10. Appendices

- `docs/lab-probe-2026-09-07.txt` — raw capability probe (what the lab denies).
- `docs/week1-closeout.md` — the rebuild-from-zero runbook.
- `docs/DEMO-RUNSHEET.md` — the live-demo script.
- `docs/checkpoint.html` — the Week-1 checkpoint deck (architecture SVG is here).
- `docs/autoscaling-evidence.txt` — HPA event history + k6 summary from the §7 run.
- Terraform module tree + key `.tf` excerpts.
- `scripts/teardown.sh` verification transcript.
