# infra/terraform

Terraform is split **by lifetime, not by resource type** (SYSTEM-DESIGN.md §7).

| Layer | Contents | Lifetime | Cost |
|---|---|---|---|
| [`00-bootstrap/`](./00-bootstrap/) | State bucket | Once, by hand — not Terraform | ~$0 |
| [`10-foundation/`](./10-foundation/) | ECR ×3, S3 uploads bucket, Secrets Manager ×3 | **Permanent** — never destroyed | ~$1/mo |
| [`20-platform/`](./20-platform/) | EKS, managed node group, RDS, NLB, `rds-master` secret | **Destroyed every session** | ~$180/mo if left up |

`20-platform/` is scaffolded and `terraform validate`-clean but **not yet applied**.
Expect its first one or two applies to fail on the lab role ARNs or a subnet AZ;
that is the plan working (PROJECT-KNOWLEDGE-BASE.md §7). See its own README.

## Order of operations, first time on a fresh account

```bash
#   1. create the state bucket        → 00-bootstrap/README.md
#   2. terraform -chdir=10-foundation init && apply
#   3. enter real secret values       → 10-foundation/README.md
#   4. (Day 2) terraform -chdir=20-platform init && apply
```

## AWS credentials

Terraform has no credential store of its own — the AWS provider reads the standard
AWS SDK chain (env vars → `~/.aws/credentials` → `~/.aws/config`). Our config sets
only `region` and an `allowed_account_ids` guard; **no keys live in any `.tf` file.**

The Learner Lab issues **temporary STS credentials** (`ASIA…` + a session token)
that expire when the 4-hour session ends. Each session:

1. Learner Lab → **Start Lab** → **AWS Details** → *AWS CLI: Show*.
2. Paste that block into `~/.aws/credentials` under `[default]` — **into the file
   directly, never into a chat, terminal history, commit, or this repo.** It holds
   three lines: `aws_access_key_id`, `aws_secret_access_key`, `aws_session_token`.
3. `aws configure set region us-east-1` (once; the lab is us-east-1 only).
4. Verify — this output is safe to share:
   ```bash
   aws sts get-caller-identity   # Account 735838417080, Arn .../voclabs/...
   ```

If a session token ever lands somewhere it shouldn't: **End Lab → Start Lab**
invalidates it immediately. Paste command *output*, never `aws_secret_access_key`
or `aws_session_token` (see the incident in PROJECT-KNOWLEDGE-BASE.md §2).

`~/.aws/credentials` is outside the repo and is not — and must not be — tracked.

## Session ritual

`10-foundation` is applied **once** and left alone. Every working session only
touches `20-platform` (apply at the start, `scripts/teardown.sh` at the end).
Never start an EKS apply after hour 3 of a lab session — credentials expire
mid-run and leave a billable half-built stack.
