# Eventide — Cloud Computing 2026 Project Report

> **Status: skeleton.** Section headings, the argument for each, and the evidence
> each one needs. Fill the prose as the work lands. Companion docs:
> [`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) (what), [`PROJECT-KNOWLEDGE-BASE.md`](./PROJECT-KNOWLEDGE-BASE.md)
> (why + the decision log), [`TODO.md`](./TODO.md) (build state).
>
> **The report is graded alongside the demo.** Lead every section with the
> trade-off, not the feature list — naming a rejected alternative scores better
> than the alternative would have. Source list: `PROJECT-KNOWLEDGE-BASE.md` §5.

---

## 1. Abstract / overview

- One paragraph: an event-listing + ticket-registration platform, built to
  justify a real microservice topology and exercise every required AWS service,
  on an AWS Learner Lab account with a **$50 hard cap**.
- The thesis of the whole project: **infrastructure-heavy, feature-poor by
  design.** Infrastructure does not compress under deadline pressure; features
  do.

## 2. Requirements & scope

- What was built: 3 Elysia/Bun microservices (`auth`, `event`, `registration`)
  on EKS, 1 static React SPA on S3 + CloudFront.
- What was deliberately **not** built and why (each is a report win, not a gap):
  BFF/API-gateway, Prometheus/Grafana, separate RDS per service, GitHub Actions
  OIDC deploy, cert-manager. → `PROJECT-KNOWLEDGE-BASE.md` §3, §7.
- **Caveat to state plainly:** the assignment brief was never available as text;
  scope is inference about what is graded. If the rubric named something we cut,
  say so here rather than let a marker find it.

## 3. Architecture

- Diagram: `docs/architecture/aws/` (regenerate to final before submission).
- Request path: client → NLB (Terraform-managed) → ingress-nginx (NodePort) →
  service → RDS (one instance, one database per service).
- The three services and their responsibilities; `registration` **owns and
  enforces capacity** by counting its own rows in one local transaction.
- Data model per database. No cross-database joins or foreign keys — the service
  boundary is Postgres-enforced, not convention.

### Trade-offs to foreground here

1. **Service boundary placed to avoid a distributed transaction** — capacity
   lives with the ticket rows; booking is one local transaction, not a saga.
2. **Logical database-per-service on a shared instance**, with a documented
   migration path to physical isolation.
3. **Asymmetric JWT via JWKS** — `event`/`registration` hold only a public key
   and are cryptographically incapable of minting a token. The DB boundary made
   the naive alternatives impossible — a constraint that *improved* the design.
4. **Monorepo for dev velocity, independently deployed containers at runtime** —
   name the distinction between delivery and architecture.
5. **Build-time type coupling, zero runtime coupling** — Eden Treaty gives the
   SPA end-to-end types across three services; the containers stay independent.

## 4. Infrastructure as Code

- Terraform split by **lifetime**: `00-bootstrap` (state bucket, by hand) ·
  `10-foundation` (ECR, S3, Secrets Manager — never destroyed) · `20-platform`
  (EKS, RDS, NLB, ingress-nginx — destroyed every session).
- **Raw `aws_eks_cluster` + `aws_eks_node_group`, not `terraform-aws-modules/eks`.**
  The module reads `aws_iam_session_context` → `iam:GetRole` on `voclabs`, which
  `Pvoclabs2` explicitly denies. Native `bootstrap_cluster_creator_admin_permissions`
  resolves the creator server-side with zero IAM reads. → decision log, §3.
- **Every S3 bucket is CLI-created and consumed as `data "aws_s3_bucket"`** — an
  org SCP denies `s3:GetBucketObjectLockConfiguration`, which a managed
  `aws_s3_bucket` reads on every refresh. Config lives in granular
  `aws_s3_bucket_*` resources.
- **No `iam:CreateRole`** → Terraform reuses the lab's pre-created
  `LabEksClusterRole` / `LabEksNodeRole`, looked up by `name_regex` (never
  hardcoded — the prefix changes on every lab reset).
- State: S3 backend with native lockfile, no DynamoDB.
- Evidence: `terraform apply` output, `terraform state list`, the teardown
  verification sweep coming back empty.

## 5. Kubernetes & deployment

- ingress-nginx as a **NodePort Service + a Terraform-created NLB**, not
  `Service type=LoadBalancer` (whose ELB is invisible to Terraform state and
  orphans on destroy, burning budget).
- Distroless + compiled Bun binary: `apps/event` image is ~44 MB. Why the
  compiled binary (runtime memory, pod density) — §12.1.
- Local parity: **k3d runs the same `infra/k8s/` manifests byte-identical.**
  GATE: `curl` against k3d and the EKS NLB return the same responses.
- **CI/CD stops at the image.** No OIDC federation in the lab → deploy is a
  local script (`scripts/deploy.sh`) run with fresh session credentials. In an
  unrestricted account the same pipeline assumes a role and deploys itself.

## 6. Security

- **IRSA was unavailable** (`iam:CreateOpenIDConnectProvider` denied) → static
  credential injection via External Secrets Operator. Pods reading node
  credentials via IMDS is something you would *block* in production — state the
  trade-off, don't hide it.
- **Bearer tokens over `httpOnly` cookies** — environment parity under a
  no-TLS-on-the-load-balancer constraint; the `localStorage`/XSS exposure is
  stated.
- **NAT gateway deliberately avoided** — public subnets + security-group
  isolation, a cost-driven trade-off in a $50-capped account. RDS SG admits only
  the node SG.
- Secrets Manager → K8s Secret via ESO on EKS; `kubectl create secret` from a
  local file on k3d. **App code only ever reads `process.env`** — same code both
  ways.
- Security incident: live lab credentials were pasted into a chat 2026-09-06;
  the session was rotated. Mentioned because "we rotated exposed credentials" is
  a bad line to have to write — the process fix matters.

## 7. Observability & autoscaling

- `metrics-server` (Helm, via Terraform) feeds an **HPA on `event`**: CPU 60%,
  min 2, **max 8**.
- **Pod IP ceiling:** the VPC CNI caps pods/node; 8 is chosen against that
  limit, not arbitrarily. Beyond it pods sit `Pending` with an error that reads
  like a bug.
- CloudWatch Container Insights: Terraform add-on **if** `iam:AttachRolePolicy`
  lets us attach `CloudWatchAgentServerPolicy` to the node role. Fallback
  evidence: `kubectl top pods` + the HPA event log.
- Load test: k6 (`load/k6/events.js`) against `/api/events`.
- **Evidence:** `kubectl get hpa -w` showing 2 → 8 → 2, pod-count screenshots,
  the k6 summary, Container Insights graphs (or `top` snapshots).

## 8. Cost

| Resource | Per hour | Per day idle |
|---|---:|---:|
| EKS control plane (delete-only, cannot stop) | $0.100 | $2.40 |
| 2 × t3.small nodes | *(lab auto-stops; ASG relaunches)* | — |
| Network Load Balancer | $0.023 | $0.54 |
| RDS db.t3.micro (lab does not stop RDS) | $0.018 | $0.43 |
| NAT gateway | $0.000 | avoided by design |

- ~**$1.10 per 4-hour session**; ~**$25 total** across the project vs ~**$180**
  if `20-platform` were left running.
- **Cost optimisation through ephemeral infrastructure** — and the real
  secondary benefit: by demo day the stack has been rebuilt from zero ~20 times,
  so the IaC is genuinely exercised.
- Fill actual numbers from the Learner Lab credit meter before submission.

## 9. What we'd do differently / next steps

- BFF/API-gateway for response aggregation at scale.
- Prometheus + Grafana for richer dashboards.
- IRSA instead of static credentials.
- GitHub Actions deploying via OIDC.
- Per-service RDS instances if one outgrows the shared instance.
- **Go was evaluated and rejected** on delivery risk (a third new thing in a
  4-week solo timeline), not ignorance — it would give ~15 MB images and a
  denser autoscaling demo.

## 10. Appendices

- `docs/lab-probe-2026-09-06.txt` — raw capability probe output.
- Terraform module tree, key `.tf` excerpts.
- Full `scripts/teardown.sh` verification transcript.
- Demo runsheet — `docs/DEMO-RUNSHEET.md`.
