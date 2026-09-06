# 20-platform — the disposable layer

**Lifetime: one session.** `terraform apply` at the start, `scripts/teardown.sh` at
the end. ~$0.27/hr up (~$180/mo if left). Leaving it up between sessions exhausts
the $50 cap in ~15 days.

| Resource | Notes |
|---|---|
| EKS control plane (`eventide`, k8s 1.33) | **Raw `aws_eks_cluster`** — the community module `GetRole`s `voclabs` (denied by `Pvoclabs2`). Reuses `LabEksClusterRole` (regex + `one()`). `bootstrap_cluster_creator_admin_permissions = true`. `bootstrap_self_managed_addons = false` + managed vpc-cni/kube-proxy/coredns addons. |
| Managed node group | 2 × `t3.small` (`-var node_instance_type=t3.medium` for the week-4 HPA demo), AL2023. Reuses `LabEksNodeRole`. min 2 / max 4. |
| RDS PostgreSQL | `db.t3.micro`, default (public) subnets, SG-isolated to the node SG, `publicly_accessible = false`. No backups / no final snapshot / no deletion protection. |
| NLB + 2 target groups + ASG attachments | `:80`/`:443` TCP → ingress-nginx NodePorts (`30080`/`30443`). Built by Terraform so `destroy` is reliable. |
| **ingress-nginx** (`helm_release`, `addons.tf`) | Chart 4.15.1, NodePort, values from `infra/helm/ingress-nginx.values.yaml`. In Terraform so `make up` gives a cluster that's ready for the app; dies with the cluster on `down`. |
| `eventide/rds-master` secret | master creds + endpoint for the DB-bootstrap Job. |

## Prerequisites

- `10-foundation` applied.
- Fresh lab credentials in `~/.aws/credentials` (see `../README.md`).
- `bash scripts/check-lab.sh` re-run if the lab was reset since last time — the
  `LabEks*Role` suffixes change and `one()` in `data.tf` will fail if the regex
  stops matching exactly one role.
- **First clean apply: 2026-09-07, ~19 min** (cluster 10m, node group 3m, RDS 5m,
  NLB 3m — cluster and NLB run in parallel).
- **Time left in the session > 30 min.** The apply is ~15-20 min; credentials
  expiring mid-apply leave a billable half-built stack. Never start after hour 3.

## Apply

```bash
terraform -chdir=infra/terraform/20-platform init
terraform -chdir=infra/terraform/20-platform apply     # ~18 min

aws eks update-kubeconfig --region us-east-1 --name eventide
kubectl get nodes                                        # GATE: 2 × Ready
```

**Expect the first one or two applies to fail** (PROJECT-KNOWLEDGE-BASE.md §7) —
almost always the role regex or a subnet AZ. Read the error, fix, re-apply.

## Teardown — every session

```bash
bash scripts/teardown.sh     # kubectl delete ingress → destroy → verify empty
```

Read the verification block. Every list must be empty. Then check the lab credit.

## Known follow-ups (not yet wired)

- ingress-nginx Helm install with the NodePorts above (week 1 Day 3).
- `:443` listener → TLS type + ACM cert ARN (week 2).
- DB-bootstrap Job that reads `eventide/rds-master` and creates the 3 DBs + users.
- `AttachRolePolicy` test — if it works, attach S3/SecretsManager to the node role
  and the per-session credential Secret disappears.
