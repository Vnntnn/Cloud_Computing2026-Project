# Eventide — System Design

**Project:** Cloud Computing 2026 term project, IT KMITL
**Repo:** `Cloud_Computing2026-Project`
**Target environment:** AWS Academy Learner Lab, account `735838417080`, region `us-east-1`
**Last updated:** 2026-09-06

> "Eventide" is a working name for the application. Rename freely.

---

## 1. Overview

Eventide is an event-listing and ticket-registration platform, decomposed into three
independently deployed microservices running on Amazon EKS, with a single static
frontend served from S3 + CloudFront.

The project is graded on **both** the application and the cloud infrastructure, with a
written report and a live demo. The design is therefore deliberately **feature-poor and
infrastructure-heavy**: the smallest application that still justifies a genuine
microservice topology and exercises every required AWS service.

### Required AWS services and where each is used

| Service | Use |
|---|---|
| **EKS** | Runs the three application services. Managed node group, 2 × `t3.medium`. |
| **RDS (PostgreSQL)** | One `db.t3.micro` instance hosting three isolated databases. |
| **S3** | Event cover images (presigned upload/read) **and** the static frontend bundle. |
| **Secrets Manager** | Per-service DB credentials and the JWT signing key. |
| ECR | Container image registry. |
| CloudFront | CDN in front of the static frontend. |
| CloudWatch | Container Insights for pod CPU/memory metrics. |

---

## 2. Architecture

```
                          Browser (React SPA)
                                  │
                 ┌────────────────┴────────────────┐
                 │ GET /                           │ /api/*
                 ▼                                 ▼
        CloudFront + S3                  Network Load Balancer
        (static bundle)                  (created by Terraform)
                                                   │
                                                   │ NodePort
┌──────────────────────────────────────────────────┼──────────────────────────┐
│ EKS 1.33 · 2 × t3.medium · default VPC public subnets (us-east-1a/b/c)      │
│                                                   ▼                          │
│                                            ingress-nginx                     │
│                    ┌──────────────────┬───────────┴────────┬───────────────┐ │
│                    ▼                  ▼                    ▼               │ │
│              /api/auth/*        /api/events/*     /api/registrations/*     │ │
│                 [auth]             [event]           [registration]        │ │
│                    │                  │                    │               │ │
│                    │                  │      HTTP (in-cluster enrichment)  │ │
│                    │                  └◄───────────────────┘               │ │
│                                                                             │ │
│   Secrets Manager ─(deploy.sh)─► Kubernetes Secrets ──► process.env         │ │
└──────────────────────────────────────────────────┬──────────────────────────┘
                                                   │
              ┌────────────────────┬───────────────┴────────┐
              ▼                    ▼                        ▼
      RDS PostgreSQL              S3                  Secrets Manager
   auth_db │ event_db │        presigned            3 secrets, one per
      registration_db          PUT / GET                 service
```

### 2.1 Why one frontend, not three

Microservices is a **backend** decomposition pattern; it says nothing about the frontend.
Micro-frontends (Module Federation, single-spa) exist to let many frontend *teams* deploy
independently — a problem this project does not have. One SPA calls all three services
through path-based ingress routing and is unaware there is more than one backend.

The SPA is **not a microservice**. It is a static bundle: no pod, no container, no
deployment. It lives in S3 behind CloudFront.

### 2.2 Why the load balancer is built by Terraform

When Kubernetes creates a `Service type=LoadBalancer`, the resulting ELB is **not in
Terraform state**. `terraform destroy` then fails on the VPC because network interfaces
are still attached to a load balancer it does not know about — it hangs ~20 minutes and
errors out, leaving billable resources running.

ingress-nginx therefore runs as a **`NodePort` Service**, with an **NLB created by
Terraform** targeting the node group. This solves two problems at once:

1. No in-cluster AWS credentials are needed to provision the load balancer (important —
   IRSA is unavailable, see §5).
2. The load balancer is in Terraform state, so teardown is reliable.

---

## 3. Services

| Service | Owns | Talks to |
|---|---|---|
| **auth** | Users, login, JWT issuance | `auth_db` |
| **event** | Event metadata, cover images, `capacity` as a static number | `event_db`, S3 |
| **registration** | Tickets, signups, **enforcement** of capacity | `registration_db`, `event` (HTTP) |

Three is both the ceiling and the minimum. Two services demonstrate a service-to-service
call; three demonstrate a topology with a real reason to split. Beyond three, a solo
developer ends the term with several half-finished services and nothing deployed.

### 3.1 API surface

**`auth` mounts better-auth**, which owns `/api/auth/*` and supplies these itself:

```
POST   /api/auth/sign-up/email
POST   /api/auth/sign-in/email         → session + bearer token
POST   /api/auth/sign-out
GET    /api/auth/get-session
GET    /api/auth/token                 → JWT              (jwt plugin)
GET    /api/auth/jwks                  → public keys      (jwt plugin)
```

`/api/auth/jwks` is the important one: it is how `event` and `registration` verify
callers without ever talking to `auth` or to `auth_db`. See §5.

```
GET    /api/events                     → list
POST   /api/events                     (auth)
GET    /api/events/:id
POST   /api/events/:id/cover-upload    (auth) → { uploadUrl, key }   presigned PUT

POST   /api/registrations              (auth) { eventId }
GET    /api/registrations/me           (auth) → tickets enriched with event titles
GET    /api/registrations/event/:id/count
```

Every service exposes:

- `GET /health/live` — process is alive. **Must not touch the database.**
- `GET /health/ready` — checks the DB connection.
- `GET /swagger` — interactive OpenAPI page (`@elysiajs/openapi`, path pinned to `/swagger`).

> The liveness/readiness distinction is load-bearing. A liveness probe that queries
> Postgres turns a five-second RDS blip into every pod restarting simultaneously.

---

## 4. Data design

### 4.1 One RDS instance, one database per service

```
RDS db.t3.micro
├── auth_db          owner: auth_svc          (no grants on the others)
├── event_db         owner: event_svc
└── registration_db  owner: registration_svc
```

**Why database-per-service rather than schema-per-service:** PostgreSQL **cannot** join
across databases — not "should not", *cannot*, without a foreign data wrapper. The service
boundary is enforced by the engine rather than by developer discipline. Schemas rely on
grants staying correct forever.

**Why not three RDS instances:** three times the cost and three times the provisioning
time, for identical pedagogical value. The chosen design is documented in the report as
*logical isolation on a shared instance, with a migration path to physical isolation.*

**Consequence, accepted deliberately:** no cross-service foreign keys and no cross-service
joins.

### 4.2 Schemas

**`auth_db` is owned entirely by better-auth.** Do not hand-write its schema. The Drizzle
adapter generates `user`, `session`, `account`, `verification`, and — from the JWT plugin —
`jwks`. Generate migrations with the better-auth CLI and run them through the same
migration Job as the other two services.

> **Identifier type.** better-auth generates `id` as **`text`**, not `uuid`. Every
> cross-service reference to a user is therefore `text`. Do not "fix" this to `uuid`
> without also setting `advanced.database.generateId` — mismatched id types across
> services is a slow, confusing bug.

```sql
-- event_db
CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  venue        text NOT NULL,
  starts_at    timestamptz NOT NULL,
  capacity     integer NOT NULL CHECK (capacity > 0),
  cover_key    text,                      -- S3 object key, not a URL
  owner_id     text NOT NULL,             -- better-auth user.id — NO FK, different DB
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- registration_db
CREATE TABLE tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL,           -- events.id — NO foreign key, different DB
  user_id        text NOT NULL,           -- better-auth user.id — NO FK, different DB
  event_title    text NOT NULL,           -- denormalised at booking time
  event_capacity integer NOT NULL,        -- copied at booking time
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX ON tickets (event_id);
```

### 4.3 Capacity ownership — the boundary that avoids a distributed transaction

Capacity is **enforced by `registration`**, not by `event`.

If `event` owned "seats remaining", booking a ticket would write to two databases — a
distributed transaction requiring sagas or two-phase commit. Because `registration` owns
the ticket rows, it enforces capacity by counting its own table inside a single local
transaction:

```sql
BEGIN;
SELECT count(*) FROM tickets WHERE event_id = $1 FOR UPDATE;
-- compare against event_capacity copied at booking time
INSERT INTO tickets (...) VALUES (...);
COMMIT;
```

`event` remains the source of truth for the capacity *number*; `registration` reads it
once over HTTP and stores it alongside the ticket.

> **Report note:** state explicitly that the service boundary was placed to avoid a
> distributed transaction. That single sentence demonstrates more understanding than a
> working saga implementation would.

### 4.4 Cross-service reads

"My tickets, with event names" is resolved by `registration` calling `event` **server-side**
and returning enriched rows — one frontend request, one in-cluster hop. The browser never
performs N+1 fan-out.

This is the inter-service communication demonstrated in the demo. A dedicated
BFF/API-gateway service would be the pattern at scale; it is deliberately **not** built
here (a fourth service to deploy and debug for no marks) and is named in the report as the
next step.

---

## 5. Security and secrets

### 5.1 Authentication — better-auth, JWT plugin, bearer plugin

`auth` mounts **better-auth** with the **Drizzle adapter**, the **JWT plugin**, and the
**bearer plugin**.

**Why the JWT plugin is mandatory here, not optional.** better-auth defaults to
`session_token` cookies, and every session check hits the database. In this topology that
would leave `event` and `registration` two ways to authenticate a caller:

1. Call `auth` over HTTP on every request — a network hop per request, making `auth` a
   hard runtime dependency of everything else.
2. Read the session table directly — **which this architecture forbids.** `event_svc` holds
   no grant on `auth_db`, and PostgreSQL cannot join across databases (§4.1).

The database boundary chosen in §4 rules out option 2 by construction. So:

```
auth  ──mints──►  JWT (asymmetric, kid in header)
  │
  └── exposes GET /api/auth/jwks   (public keys only)
                    │
      event, registration ──► jose createRemoteJWKSet ──► verify locally
                              no DB call · no hop to auth · cached
```

This is **stronger** than a shared HMAC secret: the other two services hold only a public
key and are cryptographically incapable of minting a token.

Key material never leaves `auth`. better-auth generates the JWKS keypair and stores it in
the `jwks` table, encrypted with AES-256-GCM derived from `BETTER_AUTH_SECRET`. Signing
keys can be rotated with `rotationInterval` and a `gracePeriod`, so existing sessions
survive rotation.

**Why the bearer plugin, and not cookies.** The SPA sends `Authorization: Bearer <token>`
rather than relying on better-auth's cookie. This is forced by a constraint that has
nothing to do with auth — see §5.5.

> **Report note:** a bearer token held in `localStorage` is readable by XSS, where an
> `httpOnly` cookie is not. This was chosen for environment parity (§5.5) and the exposure
> is documented rather than hidden.

### 5.1.1 Providers — Google OAuth **and** email/password

The primary login is **Google OAuth** via better-auth's social provider. Email/password
stays enabled alongside it, for two non-negotiable reasons:

1. **The seed Job cannot create OAuth users.** It inserts 15 events with owners, and those
   user rows must exist. With OAuth-only, every nightly rebuild would require hand-clicking
   through Google before the data made sense.
2. **Demo-day resilience.** OAuth depends on campus wifi, Google's availability and your
   account state. An OAuth-only system with any of those degraded has no way in. The
   fallback costs nothing and is never mentioned unless needed.

**Google's redirect URI rules are a hard constraint, not a preference:**

- Must use **HTTPS**. The only exception is `http://localhost` / `http://127.0.0.1`.
- **Exact match, no wildcards.**

So `http://<nlb>.elb.amazonaws.com/api/auth/callback/google` **cannot even be registered** —
Google rejects it in the console. This is what forces a stable HTTPS hostname (§5.5).

Register exactly two:

```
http://localhost:3000/api/auth/callback/google        dev — allowed because localhost
https://api.<domain>/api/auth/callback/google         deployed
```

Development is unaffected: run `auth` locally, or `kubectl port-forward` to it in k3d or
EKS. The browser sees `localhost` either way. **Never attempt OAuth against the bare NLB.**

**Consent screen:** set it to **In production**. Only `openid`, `email` and `profile` are
requested — all non-sensitive scopes, so Google requires no verification review and shows
no unverified-app warning. Testing mode restricts sign-in to explicitly added accounts,
which fails the moment anyone else tries to log in during the demo.

**Egress check:** OAuth requires outbound access from the pod to Google. Nodes sit in
public subnets with `MapPublicIpOnLaunch=true` behind an internet gateway, so this works
without a NAT gateway — but verify it early with `curl https://accounts.google.com` from
inside a pod. Broken egress surfaces as an OAuth timeout that looks nothing like a
networking fault.

> **Demo contingency.** If TLS or DNS misbehaves on the day,
> `kubectl port-forward svc/auth 3000:3000` against the real EKS cluster yields
> `http://localhost:3000`, which Google accepts and which is still genuinely your deployed
> pods. Weaker as theatre; a working demo beats a broken one.

### 5.2 Secret delivery

```
AWS Secrets Manager        eventide/rds-master   (Terraform writes it each rebuild:
        │                                         master creds + per-service passwords
        │                                         + BETTER_AUTH_SECRET)
        │  scripts/deploy.sh   (runs on your laptop with the lab session creds,
        ▼                       reads rds-master, composes each DATABASE_URL)
Kubernetes Secret          eventide-auth · eventide-event · eventide-registration
        │                   (kubectl create secret — plus the session's AWS_* keys
        │                    into eventide-event for S3 presigning)
        │  envFrom.secretRef
        ▼
process.env.DATABASE_URL   the application knows nothing about AWS
```

**As built:** `scripts/deploy.sh` is the delivery mechanism on EKS — it reads
`eventide/rds-master` (the one secret Terraform maintains) and `kubectl create secret`s
the three `eventide-<svc>` Secrets the pods read via `envFrom`. On k3d the same three
Secrets come from `scripts/k3d-up.sh` reading a local file. **Identical app code,
identical chart, one `eso.enabled` toggle** — see §5.2.1 for why ESO stays off here.

Contents:

| Secret | Holds |
|---|---|
| `eventide-auth` | `DATABASE_URL` (auth_db), **`BETTER_AUTH_SECRET`** (key-encryption key for the JWKS private keys). `BETTER_AUTH_URL` comes from the chart (`publicUrl`); `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` added when OAuth is wired. |
| `eventide-event` | `DATABASE_URL` (event_db), `S3_BUCKET_NAME`, `S3_REGION`, and the session's `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` for presigning |
| `eventide-registration` | `DATABASE_URL` (registration_db) |

Note what is **not** here: no shared JWT signing key. `event` and `registration` fetch
public keys from `auth`'s JWKS endpoint at runtime, so there is no signing material to
distribute (§5.1).

**Environment variables are validated with Zod at process start**, so a missing injected
secret fails with a clear message instead of a mystery crash.

### 5.2.1 Why not the External Secrets Operator on EKS

The chart carries a full ESO setup — `ClusterSecretStore` + one `ExternalSecret` per
service, behind `eso.enabled` (`infra/helm/eventide/templates/externalsecrets.yaml`).
It is **off on EKS** and used by neither environment, for a concrete reason:

ESO runs *in* the cluster and must call `secretsmanager:GetSecretValue`. Its options for
AWS credentials are IRSA (unavailable — no `iam:CreateOpenIDConnectProvider`) or the node
instance role via IMDS. The pre-created node role carries only the three `AmazonEKS*`
policies — **no Secrets Manager** — and `iam:AttachRolePolicy` is denied, so it can't be
granted. The only way to make ESO work is to hand it a `secretRef` to a Secret of static
session credentials that **expire every ~4 h and must be refreshed by a deploy anyway** —
at which point it is strictly more moving parts than `deploy.sh` doing the
`kubectl create secret` itself. So `deploy.sh` does. The ESO path is kept in the chart
for a non-lab environment where IRSA is available.

### 5.3 Credentials for pods (IRSA is unavailable)

`iam:CreateOpenIDConnectProvider` is denied in the Learner Lab, so IAM Roles for Service
Accounts cannot be used. The two remaining options:

1. **Attach policies to `LabEksNodeRole`** so pods get credentials from IMDS automatically,
   no expiry. **Ruled out 2026-09-07:** `iam:AttachRolePolicy` is denied
   (`docs/lab-probe-2026-09-07.txt`), and the pre-created node role carries only the three
   `AmazonEKS*` policies — no S3, no Secrets Manager.
2. **Inject the lab session credentials where needed**, refreshed each deploy by
   `scripts/deploy.sh` (`aws configure export-credentials`). This is what's built:
   `deploy.sh` itself uses the session creds to read `eventide/rds-master` and build the
   k8s Secrets, and puts `AWS_*` into `eventide-event` so the `event` pod can presign S3
   URLs — the app's one direct AWS call. Everything expires every ~4 h; a redeploy
   refreshes it, which the session lifecycle requires regardless.

> **Report note:** static, short-lived credentials in a cluster Secret is not how you would
> run this in production (you would use IRSA / Pod Identity). It is a deliberate workaround
> for a lab that denies both OIDC federation and policy attachment. Name the trade-off.

### 5.4 Network posture

Nodes and RDS sit in the **default VPC's public subnets** — deliberately, to avoid a NAT
gateway (see §8). Isolation is by security group: RDS accepts connections only from the
node security group and is not publicly accessible. This trade-off is documented in the
report rather than hidden.

### 5.5 TLS, mixed content, and why auth is header-based

Two independent browser constraints force HTTPS on the deployed system:

> 1. An SPA served over **HTTPS** cannot call an API over **HTTP**. Browsers block it as
>    mixed content — fatal, and unrelated to authentication.
> 2. **Google will not accept a non-HTTPS redirect URI** outside `localhost`, so OAuth
>    cannot work against a plain-HTTP load balancer at all (§5.1.1).

The project uses a **custom domain**, which supplies the stable hostname both of these need
— the NLB's own DNS name changes on every nightly rebuild and is therefore useless as an
OAuth redirect target.

**Auth stays header-based (`Authorization: Bearer`) regardless of how TLS is terminated.**
The header behaves identically in development (`localhost` over HTTP, which browsers and
Google both permit) and in the deployed system. Cookies would need `SameSite=None; Secure`
in one environment and first-party in the other — two configurations to keep alive.

### 5.5.1 Where TLS is terminated — three options

| | Approach | Notes |
|---|---|---|
| **1** | **Cloudflare proxied DNS → NLB.** Proxied CNAME, Cloudflare terminates TLS, origin fetch over plain HTTP. | Zero new AWS services. Rebuild updates take **seconds** via the Cloudflare API — a proxied record has no client-side TTL to wait out. Survives switching to a teammate's AWS account with a single CNAME change. Origin leg unencrypted (Flexible SSL) — state this in the report. |
| **2** | **Delegate a subdomain to Route 53 + ACM.** `events.<domain>` → ALIAS to the NLB, wildcard cert from ACM with DNS validation, TLS terminated at the NLB's `:443` listener. | **CHOSEN 2026-09-07** (user's call). Adds Route 53 and ACM to the architecture; the ALIAS record is managed by Terraform in `20-platform`, so nightly rebuilds re-point DNS **automatically** with no external API call. Costs $0.50/month for the hosted zone. |
| **3** | cert-manager + Let's Encrypt in-cluster | Kubernetes-native and impressive, but Let's Encrypt permits only **5 duplicate certificates per week** for an identical domain set, so nightly rebuilds exhaust the quota in five days. Viable only with a staging issuer for daily work. Rejected. |

**As built (option 2):**

- **`events.<domain>` delegated, apex stays on Cloudflare.** `NS` records for `events` point
  at the Route 53 hosted zone. This keeps any existing use of the domain untouched, and
  makes the fallback to option 1 a matter of deleting four NS records rather than
  re-delegating a live zone. Because the subdomain is fully delegated, Cloudflare's proxy
  and SSL mode do **not** apply to it — TLS is entirely AWS-side.
- **Single host.** `https://events.<domain>` serves the SPA at `/` and the APIs at `/api/*`
  through one ingress. No `api.` / `app.` split, so no CORS between origins. Google's
  callback is `https://events.<domain>/api/auth/callback/google`.
- **TLS at the NLB.** The Terraform-managed NLB gets a `:443` **TLS listener** with the ACM
  wildcard cert (`events.<domain>` + `*.events.<domain>`), forwarding **plain HTTP** to
  ingress-nginx's `:80` NodePort. The NLB→node leg is unencrypted but never leaves the VPC —
  stated in the report. ingress-nginx does no ssl-redirect (it can't see the original
  scheme through the L4 NLB); `:80` stays open for unauthenticated smoke tests.
- **Lifetime split.** Zone + cert + validation records are **permanent** (`10-foundation/
  dns.tf`) so the NS delegation is set once. Only the ALIAS A-record pointing at the current
  NLB is ephemeral (`20-platform/route53.tf`), re-created each `make up`. The cert stays
  `PENDING_VALIDATION` until the Cloudflare NS records are live, then issues on ACM's own
  retry — no second apply needed.

> **Risk this creates.** The Route 53 hosted zone lives inside the Learner Lab account. If
> you fall back to a teammate's account in demo week (§2 of the knowledge base), the zone
> must be recreated there, producing **new NS records** that need re-delegating and time to
> propagate. That materially weakens the teammate-account contingency. Option 1 does not
> have this problem. Decide with that trade-off visible.

**Consequence for scheduling:** DNS delegation propagates slowly (NS TTLs) — **do it once,
early in week 2**, not in demo week.

---

## 6. Object storage

Cover images use **presigned URLs**, not proxying:

1. Browser asks `event` for an upload URL.
2. `event` returns a presigned S3 `PUT`, valid ~5 minutes.
3. Browser uploads **directly to S3**. Bytes never enter the cluster.
4. `event_db` stores only the S3 key; reads are served via presigned `GET`.

Proxying through the pod would put every upload in pod memory — on `t3.medium` nodes with
tight limits, a few concurrent uploads is enough to trigger OOMKills, which look like
crashes during a demo.

**The S3 bucket needs a CORS policy** for browser `PUT`s. This defeats nearly everyone;
budget most of a day for it.

---

## 7. Infrastructure as code

Terraform is split **by lifetime, not by resource type**:

```
infra/terraform/
├── 00-bootstrap/     state bucket — created once, by hand, a few aws s3api commands
├── 10-foundation/    ECR, S3, Secrets Manager                 ~$1/month   never destroy
└── 20-platform/      EKS, node group, RDS, NLB, ingress-nginx  ~$180/month destroy every session
```

`make up` applies `20-platform` and points `kubectl` at it; `make down` runs
`scripts/teardown.sh`; `make deploy` (`scripts/deploy.sh`) builds/pushes images and
applies `infra/k8s/`. ingress-nginx is a `helm_release` inside `20-platform`
(`addons.tf`) — see §7.2.

State lives in S3 with native locking (`use_lockfile = true`); no DynamoDB table is needed.
Create the bucket once, by hand — do not build a module for it:

```bash
aws s3api create-bucket --bucket eventide-tfstate-735838417080 --region us-east-1
aws s3api put-bucket-versioning --bucket eventide-tfstate-735838417080 \
  --versioning-configuration Status=Enabled
```

```hcl
terraform {
  backend "s3" {
    bucket       = "eventide-tfstate-735838417080"
    key          = "20-platform/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}
```

### 7.1 Learner Lab adaptations

**The community EKS module cannot be used.** `terraform-aws-modules/eks` (every
version) reads `data "aws_iam_session_context" "current"` against the caller ARN
unconditionally, which calls `iam:GetRole` on the `voclabs` role — explicitly
denied by the lab policy `Pvoclabs2`, so `terraform plan` fails before creating
anything. No module input disables that data source (verified v19–v21.25).

The cluster is therefore **raw `aws_eks_*` resources** (`20-platform/eks.tf`):

```hcl
# iam:CreateRole is DENIED — reuse the lab's pre-created roles.
# Never hardcode the ARNs: the c219141a… prefix changes on lab reset
# and differs in each teammate's account. one() fails loudly if the regex
# stops matching exactly one role (→ re-run scripts/check-lab.sh).
data "aws_iam_roles" "eks_cluster" { name_regex = ".*LabEksClusterRole.*" }
data "aws_iam_roles" "eks_node"    { name_regex = ".*LabEksNodeRole.*" }

resource "aws_eks_cluster" "this" {
  name     = "eventide"
  version  = "1.33"
  role_arn = one(data.aws_iam_roles.eks_cluster.arns)

  bootstrap_self_managed_addons = false   # managed vpc-cni/kube-proxy/coredns instead

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true   # EKS resolves the creator
  }                                                      # server-side — no IAM read

  vpc_config {
    subnet_ids              = data.aws_subnets.abc.ids   # us-east-1a/b/c ONLY
    endpoint_public_access  = true                       # no bastion / VPN / NAT
    endpoint_private_access = true
  }
}

resource "aws_eks_node_group" "default" {
  cluster_name  = aws_eks_cluster.this.name
  node_role_arn = one(data.aws_iam_roles.eks_node.arns)
  subnet_ids    = data.aws_subnets.abc.ids
  ami_type      = "AL2023_x86_64_STANDARD"
  instance_types = ["t3.small"]   # was t3.medium — cost. Week-4 HPA demo:
  scaling_config { min_size = 2, max_size = 4, desired_size = 2 }   # -var node_instance_type=t3.medium
  depends_on = [aws_eks_addon.vpc_cni, aws_eks_addon.kube_proxy]
}
```

### 7.2 ingress-nginx via `helm_release`

Cluster add-ons that change rarely and die with the cluster are Terraform's
(`20-platform/addons.tf`), so `make up` yields a cluster ready for the app. The
`helm` provider (v3 — `kubernetes = { … }` is an *attribute*, not a block)
authenticates with a `data "aws_eks_cluster_auth"` token (STS, no extra IAM):

```hcl
resource "helm_release" "ingress_nginx" {
  name       = "ingress-nginx"
  repository = "https://kubernetes.github.io/ingress-nginx"
  chart      = "ingress-nginx"
  version    = "4.15.1"
  namespace  = "ingress-nginx"
  create_namespace = true
  values     = [file("${path.module}/../../helm/ingress-nginx.values.yaml")]
  depends_on = [aws_eks_node_group.default, aws_eks_addon.coredns]
}
```

The **app itself** (image tag changes every commit) stays in `scripts/deploy.sh`
+ raw manifests in `infra/k8s/`, not Terraform.

**No VPC is built.** The lab account already has a default VPC with six public subnets and
an internet gateway. Reusing it removes the NAT gateway ($1.08/day and the most common
cause of a silently failed teardown) and cuts ~3 minutes from every apply and destroy.

**RDS must set** `skip_final_snapshot = true` and `deletion_protection = false`, or the
nightly destroy fails.

**Database and user creation** runs as a one-shot Kubernetes `Job` in-cluster (connecting
as the RDS master), not through Terraform's `postgresql` provider — which would need
network reachability to RDS from your laptop.

**Cluster access:** the cluster is created by the `voclabs` role, and EKS records that
*role* in its access entry, so `aws eks update-kubeconfig --region us-east-1 --name eventide`
keeps working in later sessions even though session credentials change.

---

## 8. Environments

| | Local | AWS |
|---|---|---|
| Cluster | k3d (k3s in Docker), Traefik disabled | EKS 1.33, 2 × t3.medium |
| Ingress | ingress-nginx | ingress-nginx (NodePort) + Terraform NLB |
| Database | Postgres container, 3 databases via init script | RDS, 3 databases |
| Secrets | `kubectl create secret` from a local file (`k3d-up.sh`) | `kubectl create secret` from `eventide/rds-master` (`deploy.sh`); ESO templates present but off (§5.2.1) |
| Object storage | real S3 (cheap) or MinIO | S3 |
| Images | local registry `eventide-registry:5000` | ECR |
| Frontend | `vite dev` on `localhost:5173` → NLB or k3d over HTTP | Static bundle in S3, served by CloudFront (wired up in week 4 only) |
| Auth transport | `Authorization: Bearer` + CORS allowlist | `Authorization: Bearer`, same origin via CloudFront |

Create the local cluster so both environments run the same ingress controller:

```bash
k3d cluster create eventide \
  --agents 2 \
  --registry-create eventide-registry:5000 \
  --k3s-arg "--disable=traefik@server:*"   # then install ingress-nginx, as on EKS
```

Environment differences are handled by `values-local.yaml` / `values-aws.yaml` in a single
Helm chart. **No EBS CSI driver is installed** — the only database is RDS, so there are no
PersistentVolumeClaims, which conveniently sidesteps another component that would have
required IRSA.

### 8.1 Development loop

```
make dev        bun --watch × 3 + postgres container        ~1 s     inner loop
make k3d        build → k3d image import → kubectl apply    ~30 s    outer loop, daily
make deploy     build → ECR → helm upgrade                  ~2 min   AWS
make teardown   kubectl delete ingress → destroy → verify
```

Skaffold and Tilt were evaluated and rejected: at a 30-second outer loop they earn little,
and when they misbehave you debug the tool instead of the project.

Run `make k3d` **at least once a day** so manifest drift never accumulates. This is what
makes demo day boring.

---

## 9. Deployment and CI/CD

**GitHub Actions cannot deploy to this account.** OIDC federation requires an IAM identity
provider that cannot be created here, and static lab credentials expire every four hours.

| Stage | Where |
|---|---|
| Build, test, lint, type-check, image build | GitHub Actions, on every push |
| Push to ECR, `helm upgrade` | Local `./scripts/deploy.sh` with fresh session credentials |

Turborepo's affected-package filtering means only changed services rebuild.

This limitation belongs in the report **as** a limitation, with the note that in an
unrestricted account the same pipeline would assume a role via OIDC and deploy
automatically.

---

## 10. Observability and scaling

**Monitoring:** CloudWatch Container Insights (an EKS add-on configured in Terraform).
Prometheus and Grafana were **cut** — 1–2 days of Helm values and dashboard work for
metrics that Container Insights already provides adequately for the report.

**Autoscaling:** metrics-server plus an HPA on `event`, driven by CPU. Every service
declares resource requests and limits (required for HPA to work at all).

**Load test:** k6 against `/api/events` while projecting `kubectl get hpa -w` and
`kubectl get pods -w`.

> **Pod IP ceiling.** A `t3.medium` supports 3 ENIs × 6 IPv4 addresses, which the VPC CNI
> turns into **17 pods per node**. Two nodes give 34, minus ~6 system pods ≈ 28 usable.
> Scale the HPA to **8** replicas, not 80 — beyond the ceiling, pods sit `Pending` with an
> error that reads like a bug rather than a limit.

---

## 11. Cost model

| Resource | Per hour | Per day if left running |
|---|---:|---:|
| EKS control plane (**cannot be stopped, only deleted**) | $0.100 | $2.40 |
| 2 × t3.medium | $0.083 | — (lab auto-stops, but the ASG relaunches) |
| Network Load Balancer | $0.023 | $0.54 |
| RDS db.t3.micro (**the lab does not stop RDS**) | $0.018 | $0.43 |
| NAT gateway | $0.000 | $0.00 — avoided by design |
| **Total** | **$0.27/hr** | **$3.40/day** |

Budget is **$50, hard-capped**. Exceeding it locks the account and deletes all work.

- A four-hour working session ≈ **$1.10**. Twenty sessions plus demo day ≈ **$25**.
- Leaving `20-platform` up between sessions exhausts $50 in **~15 days** — before the
  final demo.

There is no middle setting. Check remaining credit in the lab UI at the start **and** end
of every session.

### 11.1 Teardown

The lab auto-stops EC2 instances, but worker nodes are in an Auto Scaling Group, which
treats a stopped instance as unhealthy and **launches a replacement**. Never rely on the
auto-stop.

```bash
# scripts/teardown.sh — write this on day 1, before there is anything to tear down
kubectl delete ingress --all --all-namespaces      # LBs Kubernetes made outside Terraform
terraform -chdir=infra/terraform/20-platform destroy -auto-approve

# then prove it, loudly
aws eks list-clusters
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier'
aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerName'
aws ec2 describe-instances --filters Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId'
```

The real argument for destroying every session is not the money — it is the repetition. By
demo day the infrastructure will have been rebuilt from zero twenty times.

---

## 12. Technology choices

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Existing fluency. Go would give ~15 MB images instead of ~90 MB and cost a week; no rubric awards marks for Go. |
| Runtime / framework | Bun + **ElysiaJS** | Familiar; `@elysiajs/openapi` generates an interactive API page from route types for free. |
| ORM | Drizzle | TypeScript-native, emits real SQL migration files to show in the report. Also the better-auth adapter. |
| Request validation | **Elysia `t` (TypeBox)** | Elysia best practice: models are `t.Object` schemas registered via `.model()`, the single source of truth for validation *and* types. **Not** Zod — a parallel schema system would break Eden's inference. |
| Env validation | Zod | Boot-time only, outside the request path. A missing injected secret fails loudly instead of crashing mysteriously. |
| Auth | **better-auth** + JWT plugin + bearer plugin | Sessions, hashing and account tables solved; the JWT plugin makes stateless cross-service verification possible without violating the DB boundary (§5.1). |
| API client | **Eden Treaty** | End-to-end types from each Elysia server to the SPA, with no codegen step. |
| Frontend | **Vite + React + Tailwind + shadcn/ui** | Static bundle, no SSR. shadcn is copy-in components, so the 2-day frontend cap stays realistic. |
| Repo | Turborepo monorepo | Shared types prevent JWT-shape drift. Services remain independently deployed containers — a delivery choice, not an architectural one. |
| Local cluster | k3d | Real Kubernetes in ~20 s; same manifests as EKS. |
| Packaging | Helm, one chart, three releases | `values-local.yaml` / `values-aws.yaml`. |
| IaC | Terraform (raw `aws_eks_*`, not the community module) | The `terraform-aws-modules/eks` module `iam:GetRole`s the `voclabs` session role, which `Pvoclabs2` denies (§7.1). Raw resources for a lab cluster are ~50 lines, not the "week" a production cluster would take. |
| Secrets | Secrets Manager → `deploy.sh` → k8s Secret (ESO templates present, off — §5.2.1) | App only ever reads `process.env`. |
| Monitoring | CloudWatch Container Insights | Terraform add-on vs. two days of Helm. |
| Load testing | k6 | Drives the autoscaling demo. |

### 12.1 Bun in Kubernetes — four required details

1. **Compiled to a single binary** with `bun build --compile --minify-whitespace
   --minify-syntax` (Elysia's recommended production path). Multi-stage: build on
   `oven/bun:1` (glibc), copy the binary onto `gcr.io/distroless/base-debian12:nonroot`.
   Runtime memory is 2–3× lower than running the source — which is what lets more pods
   fit on a `t3.medium` (§10 pod-IP ceiling). Image ends up ~80–110 MB (distroless base
   + the embedded Bun runtime), similar to the old `oven/bun:1-alpine` plan; the win is
   memory and startup, not disk.
   - libc must match: glibc build image → glibc distroless runtime, **not** alpine/musl.
   - Arch must match the target: build the image `--platform linux/amd64` for EKS.
   - Compiled Bun binaries require **AVX2** — `t3.medium` has it; CI only builds (never
     runs) the binary, so GitHub runners are fine.
   - `--minify-whitespace --minify-syntax` only — full `--minify` mangles names.
   - *(History: the original plan was `oven/bun:1-alpine` running the source at ~90 MB;
     changed to the compiled binary for the runtime-memory reduction.)*
2. **Handle `SIGTERM`**: `process.on("SIGTERM", () => server.stop())`. If Bun is PID 1 and
   ignores it, every rolling update drops in-flight requests and waits out the full grace
   period — visibly, during a scaling demo.
3. **Separate liveness and readiness probes** (see §3.1).
4. The binary already keeps the heap tight; there is no `bun --smol` process to pass flags
   to. Set container memory `requests`/`limits` so the HPA works and pods pack predictably.

### 12.2 Elysia structure — per the official best-practice guide

Every service follows the same feature-module shape:

```
apps/event/src/
├── index.ts                  app root · method-chained · exports type App for Eden
└── modules/event/
    ├── index.ts              controller — an Elysia instance, nothing else
    ├── service.ts            abstract class, static methods, does not import Elysia
    └── model.ts              t.Object schemas registered via .model()
```

Four rules taken directly from the guide:

1. **One Elysia instance = one controller.** Use the instance itself; never pass `Context`
   into a class. Passing the whole context creates type inconsistency and vendor lock-in.
2. **Models are `t.Object`, never interfaces or classes.** One definition serves as
   validation and as the type.
3. **Services split by request-dependence.** Pure logic → `abstract class` with `static`
   methods, framework-agnostic and trivially testable. Request-dependent → an Elysia
   instance exposing a `macro` (this is how better-auth's session guard is wired).
4. **Do not overuse `.decorate`.** Request-scoped values only.

> **Never break the method chain.** This is not style advice here. Losing the chain loses
> type inference, and **Eden Treaty depends entirely on that inference** — a broken chain
> silently degrades the frontend's types to `any` with no error anywhere. Elysia's best
> practices and the Eden choice are the same requirement.

### 12.3 Eden across three services

The SPA holds three clients — `edenAuth`, `edenEvent`, `edenReg` — each importing its
server's exported `App` type.

This makes `apps/web` type-depend on all three backends **at build time**, so `turbo build`
ordering matters and a type error in `registration` breaks the frontend build.

> **Report note:** build-time type coupling, **zero runtime coupling**. The deployed
> containers remain fully independent; nothing at runtime knows another service's types.

---

## 13. Repository layout

```
cloud-project/
├── apps/
│   ├── auth/              Elysia · better-auth (Drizzle + jwt + bearer plugins)
│   ├── event/             Elysia · events, S3 presigning
│   ├── registration/      Elysia · tickets, capacity
│   └── web/               Vite + React + Tailwind + shadcn/ui · Eden clients
├── packages/
│   ├── shared/            t.Object models shared across services, JWKS verifier
│   └── db/                Drizzle schema + migrations, per service
├── docs/
│   ├── SYSTEM-DESIGN.md           this file
│   └── PROJECT-KNOWLEDGE-BASE.md  decisions, constraints, rationale
├── infra/
│   ├── terraform/
│   │   ├── 00-bootstrap/   README only — state bucket by hand
│   │   ├── 10-foundation/  ECR ×3, uploads S3, Secrets Manager ×3
│   │   └── 20-platform/    raw aws_eks_* + node group, RDS, NLB, addons.tf (ingress-nginx helm_release)
│   ├── helm/
│   │   ├── ingress-nginx.values.yaml   NodePort 30080/30443, read by 20-platform/addons.tf
│   │   └── eventide/       (week 2) one chart · values-local.yaml · values-aws.yaml
│   └── k8s/               event.yaml (ns/Deploy/Svc/Ingress); (week 2) ESO, migration Job
├── scripts/
│   ├── check-lab.sh       probe Learner Lab capabilities
│   ├── lab-creds.sh       (week 2) pull session credentials into the cluster Secret
│   ├── deploy.sh          build → ECR → kubectl apply infra/k8s → set image → rollout
│   └── teardown.sh        the one that protects the $50
├── .github/workflows/     build · test · lint only
└── Makefile               dev · up · deploy · down · k3d
```

---

## 14. Demo sequence

1. **Apply from nothing.** Start `terraform apply` at the beginning and talk over it.
2. **Show the boundary.** Connect as `event_svc`, try to read `registration_db`, Postgres
   refuses. The architecture is enforced, not merely described.
3. **Use the app.** Log in, create an event, upload a cover image, register a ticket —
   noting the image bytes went straight to S3 and never entered the cluster.
4. **Show secrets are external.** `helm get manifest` and the container image carry no
   secret material; `kubectl get secret eventide-auth -o yaml` is populated by
   `scripts/deploy.sh` from Secrets Manager `eventide/rds-master`. Rotate one value there
   and redeploy that one service to show the chain is live. (Exact mechanic finalised at
   rehearsal — see `docs/DEMO-RUNSHEET.md`.)
5. **Scale under load.** k6 on one side, `kubectl get hpa -w` and `kubectl get pods -w` on
   the other. Replicas climb 2 → 8, then settle.
6. **Destroy it,** on purpose, in front of the room.
