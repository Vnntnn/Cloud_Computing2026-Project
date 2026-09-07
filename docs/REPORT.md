# Eventide — Cloud Computing 2026 Project Report

> **Draft — near complete.** Every section has real prose; the only `⟨…⟩` left
> are the week-4 autoscaling numbers (§7) and the final credit figure (§8), both
> from the last lab run. Companions:
> [`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) (what), [`PROJECT-KNOWLEDGE-BASE.md`](./PROJECT-KNOWLEDGE-BASE.md)
> (why + decision log), [`TODO.md`](./TODO.md) (build state).
>
> Every section leads with the trade-off. Naming a rejected alternative and the
> reason scores better than the alternative would have.

---

## 1. Overview

Eventide is an event-listing and ticket-registration platform: browse events,
log in, register for a ticket, see your tickets. It is deliberately **feature-poor
and infrastructure-heavy** — the smallest application that still justifies a real
microservice topology and exercises every AWS service the course asks for.

The target environment is an **AWS Academy Learner Lab** account with a **$50
hard cap** and four-hour credential sessions. That single constraint shapes most
of the design: infrastructure that cannot be paused is destroyed and rebuilt
every session, and every "why not the obvious approach" answer below traces back
to a permission the lab denies.

**Built:** three independently deployed Elysia/Bun microservices (`auth`,
`event`, `registration`) on Amazon EKS, one static React SPA served from inside
the same cluster, backed by one RDS PostgreSQL instance with one database per
service.

| AWS service | Where it is used |
|---|---|
| EKS | Runs the three services + the SPA, one managed node group (2 × `t3.small`, k8s 1.33). |
| RDS PostgreSQL | One `db.t3.micro`, three isolated databases. |
| S3 | Terraform state; event cover-image uploads (presigned). |
| Secrets Manager | Per-service DB credentials + the better-auth key-encryption secret. |
| ECR | Four container images. |
| ELB (NLB) | Public entry point, Terraform-managed, forwards to ingress-nginx. |
| CloudWatch | Container Insights for the autoscaling evidence *(if `iam:AttachRolePolicy` permits — see §7)*. |

## 2. Scope, and what was deliberately cut

**Caveat, stated plainly:** the assignment brief was never available as text.
Every scope decision — three services, cutting Prometheus, the frontend priority
— is inference about what is graded. If the rubric named something below as
required, that is a gap; it is called out here rather than left for a marker to
find.

Deliberately **not** built, each with its reason (`PROJECT-KNOWLEDGE-BASE.md`
§3, §7):

| Cut | Why | Named in the report as |
|---|---|---|
| BFF / API-gateway service | A fourth service to deploy and debug for no extra marks. | The pattern at scale. |
| Prometheus + Grafana | 1–2 days of Helm values and dashboards for metrics Container Insights already gives. | A richer-observability next step. |
| Separate RDS per service | 3× cost and provisioning time for identical pedagogical value. | The physical-isolation migration path. |
| GitHub Actions OIDC deploy | `iam:CreateOpenIDConnectProvider` is denied — federation is impossible here. | What CI would do in an unrestricted account. |
| cert-manager / Let's Encrypt | 5 duplicate certs per week — nightly rebuilds exhaust the quota in five days. | Viable only with a staging issuer. |
| CloudFront in front of the SPA | `cloudfront:*` denied in the lab (probed 2026-09-07). | Replaced by serving the SPA from the cluster (§5). |

## 3. Architecture

```
                         Browser (React SPA)
                                 │  one origin: http://<nlb>  (https via Cloudflare, §6)
                                 ▼
                     Network Load Balancer  (aws_lb, Terraform)
                                 │  TCP :80/:443 → NodePort 30080/30443
┌────────────────────────────────┼──────────────────────────────────────────┐
│ EKS 1.33 · 2×t3.small · default-VPC public subnets (us-east-1a/b/c)        │
│                                ▼                                          │
│                          ingress-nginx  (NodePort, not type=LoadBalancer) │
│      /            /api/auth/*      /api/events/*     /api/registrations/*  │
│     [web]           [auth]           [event]           [registration]     │
│   (nginx SPA)          │                │                   │             │
│                        │                │   ◄─── HTTP (enrichment) ───┐   │
│                        ▼                ▼                   ▼         │   │
│                     auth_db          event_db        registration_db │   │
│                        └──────────  one RDS db.t3.micro  ────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Request path.** One public NLB → ingress-nginx (a NodePort Service) →
Service → pod. The SPA and all three APIs sit behind **one origin** so there is
no CORS configuration and no mixed-content problem.

**The three services.**

- **auth** mounts *better-auth* (Drizzle adapter + JWT plugin + bearer plugin).
  Email/password and Google OAuth. Owns `auth_db`. Exposes `GET /api/auth/jwks`.
- **event** — event metadata CRUD, S3 presigned cover-image upload. Owns
  `event_db`. Verifies callers' JWTs locally (§6). Exposes `GET /api/events/:id/summary`
  for in-cluster use.
- **registration** — tickets. **Owns and enforces capacity.** Owns
  `registration_db`. Calls `event` once, in-cluster, at booking time.

### Trade-offs

1. **The service boundary is placed to avoid a distributed transaction.**
   Capacity could belong to `event` ("seats remaining"), but then booking a
   ticket writes to two databases — a saga or two-phase commit. Instead
   `registration` owns the ticket rows and enforces capacity by counting its
   own table inside one local transaction, serialised per-event with a
   transaction-scoped advisory lock:

   ```
   BEGIN;
     SELECT pg_advisory_xact_lock(hashtextextended($event_id, 0));
     -- already booked? -> 409;  count >= capacity? -> 409
     INSERT INTO tickets (...);
   COMMIT;
   ```

   `event` stays the source of truth for the capacity *number*; `registration`
   reads it once over HTTP and denormalises it onto the ticket. **Verified: three
   concurrent bookings for the last seat return `200, 409, 409` and the final
   count is 1 — no oversell.**

2. **Logical database-per-service on one instance.** PostgreSQL *cannot* join
   across databases — the boundary is engine-enforced, not a convention that
   depends on grants staying correct. Documented migration path to physical
   isolation. Consequence accepted: no cross-service foreign keys or joins.

3. **Asymmetric JWT via JWKS.** `auth` mints EdDSA JWTs and publishes only the
   public keys at `/api/auth/jwks`. `event` and `registration` fetch those keys
   with `jose` and verify locally — no per-request hop to `auth`, no database
   call. They hold only a public key and are **cryptographically incapable of
   minting a token**. The database boundary ruled out the naive alternatives
   (call `auth` every request; read its session table) — a constraint that
   *improved* the design.

4. **Monorepo for development, independent containers at runtime.** One
   Turborepo, shared types — but four separately built images, separate
   Deployments, separate scaling. Delivery convenience, not architectural
   coupling.

5. **Build-time type coupling, zero runtime coupling.** Eden Treaty gives the
   SPA end-to-end types from each Elysia server with no codegen step; the
   deployed containers never import each other.

## 4. Infrastructure as Code

All infrastructure is Terraform, **split by lifetime**:

| Layer | Contents | Lifecycle |
|---|---|---|
| `00-bootstrap` | S3 state bucket | created once, by hand (chicken-and-egg) |
| `10-foundation` | 3 ECR repos + lifecycle, 3 Secrets Manager secrets, uploads S3 bucket | applied once, **never destroyed** |
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

**One Helm chart, one release** (`infra/helm/eventide`) that ranges over the
four services. `values-local.yaml` (k3d) and `values-aws.yaml` (EKS) differ only
in image registry, replica count, the public URL, and whether ESO / the HPA are
on. *(SYSTEM-DESIGN §12 said "three releases"; one release ranging over services
was chosen for a single `helm upgrade` and one revision history — the Deployments
and HPAs are still independent.)*

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

**Images.** The three services compile to a single Bun binary
(`bun build --compile`) on `gcr.io/distroless/base-debian12:nonroot` — ~44 MB
each, 2–3× lower runtime memory than running the source, which is what lets more
pods fit under the CNI IP ceiling (§7). The `db-bootstrap` migration image is a
focused install (postgres + drizzle-orm + drizzle-kit only, not the monorepo
lockfile) — 89 MB, down from 185 MB.

**Local parity.** A k3d cluster runs the **same Helm chart** with the local
overlay. Verified end-to-end: sign in → JWT → book a seeded event → dup returns
409 → tickets list enriched — identical to EKS.

**CI/CD stops at the image.** No OIDC federation is possible (§2), so
`.github/workflows` builds and tests only; `scripts/deploy.sh` does the deploy
locally with fresh session credentials: build → push to ECR → `helm upgrade`
`-f values-aws.yaml` → `rollout status`. In an unrestricted account the same
steps run in CI against an assumed role.

## 6. Security & secrets

**IRSA is unavailable** — `iam:CreateOpenIDConnectProvider` is denied, so IAM
Roles for Service Accounts cannot be used. `iam:AttachRolePolicy` is **also
denied** (probed 2026-09-07), so pods cannot get credentials from the node role
either. The app is therefore built to need **no AWS credentials at all**: it
only ever reads `process.env`. On EKS the `eventide-<svc>` Kubernetes Secrets
are assembled by `scripts/deploy.sh` from the Terraform-managed
`eventide/rds-master` secret; the External Secrets Operator path (Secrets
Manager → K8s Secret) is templated in the chart and used once ESO is installed.
On k3d the same Secrets come from `kubectl create secret`. Same manifests, same
code.

> **Report note.** Having a deploy script hold the assembled `DATABASE_URL`
> briefly is weaker than IRSA. In production you would use IRSA or Pod Identity
> and never materialise the URL outside the pod. This is a documented workaround
> for a locked-down lab, not a recommendation.

**Asymmetric JWT** (§3, trade-off 3) — the strongest part of the auth design,
and it exists *because* the database boundary forbade the easy options.

**Bearer tokens, never cookies.** The SPA sends `Authorization: Bearer <jwt>`.
A cookie would need `SameSite=None; Secure` in one environment and first-party
in another — two configurations to keep alive. The token in `localStorage` is
readable by XSS where an `httpOnly` cookie is not; this is stated, not hidden,
and is the price of environment parity under a no-TLS-on-the-load-balancer
constraint.

**Network posture.** Nodes and RDS sit in the **default VPC's public subnets**,
deliberately — to avoid a NAT gateway ($0.045/hr + data, and the lab budget does
not allow it). Isolation is by security group: the RDS SG admits port 5432 only
from the node security group, and RDS is not publicly accessible. Pod egress to
the internet (needed for Google OAuth) goes through the internet gateway — no
NAT — verified with `curl https://accounts.google.com` from a pod (`302`).

**TLS.** CloudFront is denied and cert-manager's quota is too small for nightly
rebuilds. The plan is **Cloudflare-proxied DNS** in front of the NLB —
Cloudflare terminates TLS, the origin leg is plain HTTP inside the trust
boundary of a demo. Route 53 + ACM are permitted (probed) and remain the
alternative. *(Not yet wired — the deployed demo runs over `http://<nlb>` or a
`kubectl port-forward` for the Google-OAuth step.)*

**Incident.** Live lab credentials were pasted into a chat on 2026-09-06; the
session was rotated immediately afterward. Noted because the process fix — never
paste `aws_secret_access_key` / `aws_session_token`, only script *output* —
matters more than the one-time exposure.

## 7. Observability & autoscaling

`metrics-server` is installed by Terraform (`helm_release` in `20-platform`) and
feeds a **HorizontalPodAutoscaler on `event`**: CPU target 60 %, min 2,
**max 8**.

**The ceiling is 8 for a reason.** The VPC CNI turns a `t3.small`'s ENI/IP
budget into ~11 pods per node; two nodes minus the system and ingress pods leave
just enough for 8 `event` replicas. Scaling past that leaves pods `Pending` with
an IP-exhaustion error that reads like a bug, not a limit — so the HPA `maxReplicas`
encodes the infrastructure constraint.

**CloudWatch Container Insights** is a Terraform add-on
(`amazon-cloudwatch-observability`), **gated off by default**: its agent needs
`CloudWatchAgentServerPolicy` on the node role, and `iam:AttachRolePolicy` is
denied (§6). Fallback evidence for the report is `kubectl top pods` plus the HPA
event log — which is sufficient to show the scale-up/down.

**Load test.** `load/k6/events.js` — a ramping-VU profile against
`GET /api/events` (0 → 50 → 120 → 0 over 12 minutes) with thresholds on error
rate and p95 latency.

**Evidence to capture:** `kubectl get hpa -w` showing replicas ⟨2 → 8 → 2⟩,
`kubectl get pods -w` showing pods created then terminated, the k6 end-of-run
summary, and Container Insights graphs (or `top` snapshots) for the window.

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
- Terraform module tree + key `.tf` excerpts.
- `scripts/teardown.sh` verification transcript.
