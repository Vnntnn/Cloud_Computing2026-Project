# Production-grade network + data + edge (target diagram) — plan

Status: **phases 1-4 applied and GATE-passed on 2026-10-26 (account 524450451918); phase 5 (load test at t3.medium, teardown proof, docs/diagrams) next.** Committed on `feat/prod-infra`. Decided with the user 2026-10-25: implement the
production architecture diagram; **ALB + WAF** at the edge (CloudFront is denied in the
lab), **single-AZ** workloads as drawn. Branch: `feat/prod-infra` off `main` (not the
i18n branch).

This supersedes these knowledge-base decision-log rows (record them as superseded, with
this date and "user's call: the presentation must show a production architecture"):
"No VPC module — use the default VPC", "NAT gateway deliberately avoided", "Redis is a pod",
"ingress = NLB". Not superseded: no IRSA, no ESO, reuse `Lab*` roles, S3 bucket via CLI,
`make up` / `make down` nightly (a 24/7 production is impossible under the $50 cap).

## Probed 2026-10-25 (account 524450451918)

| Needed | Result |
|---|---|
| CloudFront, Shield | AccessDenied → ALB + WAF; Shield Standard is automatic |
| New VPC, EIP/NAT, VPC endpoints | EC2 dry-run OK |
| ElastiCache | call reaches validation → allowed |
| RDS Proxy | `LabRole` trusts `rds.amazonaws.com` → use it as the proxy role |
| WAFv2 + ELBv2 | list OK; managed rule groups visible |
| Node role `iam:AttachRolePolicy` | denied → Container Insights stays off; use CloudWatch alarms/dashboard |

## Target (single-AZ, us-east-1a)

```
Users → Route 53 (ALIAS) → ALB :443 (ACM wildcard, WAF) → ingress-nginx (NodePort)
VPC 10.20.0.0/16
  public        1a: NAT gateway · 1b: ALB-only subnet (ALB needs 2 AZs)
  private/no-egress  1a: ingress-nginx, event, registration, web   (node group "edge")
  private/NAT-egress 1a: auth, payment, mail-worker                (node group "egress")
  private/data       1a: RDS Proxy, RDS PostgreSQL, ElastiCache Redis  (+1b subnet: subnet-group minimum only)
Endpoints: S3 gateway (free); interface: ecr.api, ecr.dkr, sts, ec2, sqs
```

Why two node groups: the diagram puts `auth` / `payment` / `mail-worker` on a NAT-egress
tier because only they call out (Google OAuth, Stripe, Gmail SMTP). With vpc-cni a pod
lives in its node's subnet, so the tiers are two managed node groups + `nodeSelector`s.

AZ minimums that make "single-AZ" not literally one subnet: EKS control plane, the RDS
subnet group and the ALB each need subnets in ≥ 2 AZs. Workloads and data instances stay
in 1a; the 1b subnets are empty/ALB-only. Say so in the report.

## What lives where in Terraform

- **Permanent (root, free):** VPC, subnets, IGW, route tables (private routes to NAT added
  by the platform), S3 gateway endpoint. Leave up so `make down` stays a pure-cost teardown.
- **Platform (`modules/platform`, `var.platform`):** NAT + EIP, interface endpoints, two node
  groups, RDS + subnet group, RDS Proxy, ElastiCache, ALB + target group + listeners, WAF ACL
  + association, Route 53 ALIAS, CloudWatch alarms. The NLB file is replaced by `alb.tf`.
- **Chart/scripts:** `nodeSelector` per tier; `REDIS_URL` from `eventide-common` (not the
  in-cluster `redis` Deployment, which is removed on AWS); `DATABASE_URL` via the proxy,
  `DATABASE_MIGRATE_URL` direct to RDS for the `db-migrate` hook; ingress-nginx
  `use-forwarded-headers` (real client IP behind the ALB); ALB idle timeout ≥ 3600 s for the
  live-seats WebSocket; `teardown.sh` proof extended to NAT / EIP / ALB / WAF / endpoints /
  ENIs / ElastiCache / proxy.

## Phases — one `make up` session each, each ends with a GATE and `make down`

1. **Network + tiers.** VPC, NAT, endpoints, two node groups, RDS moved to the data subnet.
   GATE: a pod on the *edge* tier pulls its image from ECR and cannot reach the internet; a
   pod on the *egress* tier can (`curl https://accounts.google.com`); `make deploy` is green.
   Fallback if the no-egress bootstrap needs more endpoints than listed: add them (≈ $0.01/h
   each). Last resort: edge nodes get NAT but a security group allows egress only to the VPC
   CIDR + S3 prefix list.
2. **Data.** ElastiCache (single node, in-transit TLS + AUTH token, SG from nodes only) and
   RDS Proxy (secret `eventide/rds-master`, `LabRole`, TLS required). GATE: migrate OK through
   the direct URL, login + session cache work against Redis over `rediss://`, load-test pool
   behaviour through the proxy (postgres.js prepared statements pin connections; set
   `prepare: false` if pinning shows).
3. **Edge.** ALB (HTTPS, HTTP→301), WAF, Route 53 ALIAS moved from the NLB, NLB deleted.
   WAF starts in **Count** mode with: Common, KnownBadInputs, IpReputation, rate-based.
   GATE: https works, WebSocket live seats stay open, image upload (multipart) and the
   Stripe webhook are not blocked (CommonRuleSet `SizeRestrictions_BODY` and XSS rules hit
   uploads, the rich-text HTML and the raw webhook body — scope them down or exclude), the
   real client IP reaches `auth`; then flip rules to Block.
4. **Observability.** CloudWatch alarms (ALB 5xx / target health, RDS CPU + connections,
   Redis memory/evictions, DLQ depth > 0, WAF blocked count) → one SNS topic, plus a dashboard
   for the screenshots. Container Insights stays off (IAM).
5. **Prove it.** `NODE_INSTANCE_TYPE=t3.medium make up`, k6 load + HPA evidence, teardown proof
   shows nothing billable left, update `docs/diagrams/*`, `SYSTEM-DESIGN`, `KNOWLEDGE-BASE`,
   `CLAUDE.md`, `REPORT`.

## Cost (estimate from us-east-1 list prices, NOT measured)

Today ≈ $0.27/h ($1.10 per 4 h session). Added while the platform is up: NAT 0.045 · ElastiCache
t3.micro 0.017 · RDS Proxy 2 vCPU 0.03 · ALB ~0.03 · WAF ~0.01 · 5 interface endpoints 0.05 · second
node group ~0.02 → **≈ +$0.2/h, about $2 per 4 h session.** Roughly 20+ sessions of headroom if
little of the $50 is spent already (unknown: read the remaining budget from the lab page).
Never start an apply after hour 3 of a session. Phase order keeps each session's spend small.

## Review findings folded into phase 1 (2026-10-25)

- **The live platform must go down first.** A new VPC replaces the EKS cluster, DB subnet group, NLB
  and ALIAS; `terraform plan` against the live state shows them as in-place edits that would fail
  midway. Order: `make down` with the OLD code (the i18n checkout) -> in this worktree
  `terraform apply -var platform=false` (creates the free network + the ECR mirror repos) ->
  `make mirror` -> `make up` -> GATE.
- **Edge nodes can't pull from `registry.k8s.io`.** ingress-nginx and metrics-server are mirrored into
  permanent ECR repos (`scripts/mirror-images.sh`, `make mirror`); the ingress chart's digest pin is
  cleared. ECR pull-through is unusable: its first pull needs `ecr:CreateRepository` on the node role.
- VPC has DNS support + hostnames on; interface endpoints use private DNS and a 443-from-VPC SG.
- Pod density: the edge tier starts at 2 x t3.small (ingress x2, event, registration, web, coredns,
  metrics-server); the HPA-to-8 load test needs `NODE_INSTANCE_TYPE=t3.medium`.
- Before phase 2: `LabRole` may read `eventide/rds-master` (policy simulation: allowed); RDS Proxy may
  still need a `secretsmanager` interface endpoint in the data subnet; use
  `aws_elasticache_replication_group` (1 node) for TLS + AUTH; verify Bun's `rediss://` + password and
  the `seats:changed` pub/sub against it.
- `terraform validate` and a plan against the live state pass (free).

## Open items before phase 1

- ~~Remaining budget and the presentation date~~: $40 left, no deadline pressure (2026-10-25).
- Confirm the `eventide.creasy.club` wildcard cert already ISSUED covers the ALB (it does: the
  ACM cert is permanent and regional in us-east-1).

## Progress log

- **Phase 1 GATE passed 2026-10-26.** Edge pods pull from the ECR mirror with no internet; an egress pod reaches
  accounts.google.com, an edge pod times out; SQS works from the edge through its endpoint, S3 through the
  gateway endpoint; site and `/api/*/health` 200 on the domain; HPA reads metrics. Found on the way: the
  in-cluster `redis` pod (Docker Hub image) could not pull on the edge tier, and `registration` exits when Redis
  is down. metrics-server needed `nodeSelector eventide/tier=edge`.
- **Phase 2 GATE passed 2026-10-26.** ElastiCache replication group (1 node, TLS + AUTH), RDS Proxy (target
  AVAILABLE ~6 min after creation; needed the `secretsmanager` interface endpoint), new secret
  `eventide/endpoints` {DATABASE_URL via proxy, DATABASE_MIGRATE_URL direct, REDIS_URL}. The chart drops the redis
  pod and `REDIS_URL` on AWS (`null` overrides), the migrate hook uses `dbMigrate.urlKey`. Verified with a real
  signup + cross-service authed calls: the session key lands in ElastiCache, pub/sub round-trips over `rediss://`,
  the proxy multiplexed 7 client connections onto 4 DB connections with no pinned sessions (light load; redo it at
  full load in phase 5).
- **Phase 3 GATE passed 2026-10-26 (one gap, below).** ALB (HTTPS, :80 -> 301, idle timeout 3600 s) + WAF replaced the
  NLB; the Route 53 alias moved in the same apply (`depends_on` the ASG attachment and the WAF association). ALB
  health check is ingress-nginx's own `/healthz`. ingress-nginx trusts `X-Forwarded-For` from the VPC CIDR only:
  the session row now stores the real client IP (the NLB-era session stored none). WAF ran in COUNT first: it
  flagged only the XSS probe and a user-agent-less WebSocket client; a 77 KB multipart avatar upload was untouched
  (CommonRuleSet is scoped down for `multipart/form-data`), a realistic rich-text JSON body and the Stripe webhook
  path were fine. Flipped to `block` (now the default): XSS, log4j-style and path-traversal probes return 403,
  and signin, uploads, rich text, webhook and every health path still pass.
  **Not verified:** the live-seats WebSocket held open past 60 s (no event existed: creating one needs an
  organizer, and promoting a user was refused by the session's classifier; the upgrade itself works through the ALB),
  event cover upload and a real browser pass (Playwright's profile was locked). Do these with an organizer account.
  WAF logging is off (needs `logs:CreateLogGroup`, not probed); tune with `get-sampled-requests` and the
  `AWS/WAFV2` metrics.
- **Phase 4 GATE passed 2026-10-26.** `monitoring.tf`: SNS topic `eventide-alerts` (email opt-in via `alert_email`, no one
  subscribed), 15 alarms (ALB target 5xx / ALB 5xx / unhealthy targets / p95 latency, RDS CPU / connections / free
  memory, RDS Proxy pinned sessions, Redis memory / evictions / CPU, mail DLQ not empty / queue backlog, edge node CPU,
  WAF blocked burst) and a dashboard `eventide` (10 widgets + the alarm panel). Alarms use `treat_missing_data =
  notBreaching`, live in the platform module (they go away with what they watch). Verified end to end: a burst of 150
  blocked requests took `eventide-waf-blocked-burst` to ALARM (`150.0 > 100`) and 14/15 alarms settled to OK within
  ~2 min of creation. `scripts/teardown.sh` now also proves NAT gateways, EIPs, interface endpoints, ElastiCache, RDS
  proxies, WAF ACLs and alarms are gone.
