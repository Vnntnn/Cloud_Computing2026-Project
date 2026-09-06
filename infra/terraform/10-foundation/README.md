# 10-foundation — durable AWS resources

**Lifetime: permanent.** Never in the nightly `terraform destroy`. Costs ~$1/month
(S3 storage + Secrets Manager: $0.40/secret/month × 3). Holds the things that must
survive a platform teardown — pushed images, uploaded cover images, secret values.

| Resource | Why it lives here |
|---|---|
| 3 × ECR repo (`eventide/{auth,event,registration}`) | Images built by CI must outlast the cluster. |
| S3 uploads bucket (`eventide-uploads-<account>`) | Cover images are re-seeded each rebuild, but the bucket + CORS policy shouldn't churn. |
| 3 × Secrets Manager secret (`eventide/{auth,event,registration}`) | Real secret values are entered once and must not be lost on teardown. |

## Prerequisites

1. `../00-bootstrap/README.md` — the state bucket must exist.
2. Lab session credentials in `~/.aws/credentials` (they expire every 4 hours).
3. `terraform` ≥ 1.10 (`brew install terraform`).

## Apply

```bash
terraform -chdir=infra/terraform/10-foundation init
terraform -chdir=infra/terraform/10-foundation fmt -check
terraform -chdir=infra/terraform/10-foundation plan
terraform -chdir=infra/terraform/10-foundation apply
```

**GATE (docs/TODO.md §2 Day 1):**

```bash
aws ecr describe-repositories --query 'repositories[].repositoryName'
aws secretsmanager list-secrets --query 'SecretList[].Name'
```

Both must list the three `eventide/*` resources.

## Filling in real secret values

Terraform seeds each secret with placeholder keys (`REPLACE_ME`) and then
**ignores all further changes** to `secret_string`. Write real values with:

```bash
aws secretsmanager put-secret-value --secret-id eventide/auth \
  --secret-string "$(cat auth.env.json)"
```

or edit them in the console. A re-apply will not revert them. `scripts/lab-creds.sh`
(week 2) automates the DB-credential half of this.

## Overrides

Defaults target Learner Lab account `735838417080` / `us-east-1`. For a teammate's
account, either edit `variables.tf` defaults or pass `-var`:

```bash
terraform -chdir=infra/terraform/10-foundation apply \
  -var account_id=<id> -var region=us-east-1
```

...and update the `bucket` in `versions.tf` + re-run `00-bootstrap` there first.
