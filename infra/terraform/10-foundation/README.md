# 10-foundation — durable AWS resources

**Lifetime: permanent.** Never in the nightly `terraform destroy`. Costs ~$1/month
(S3 storage + Secrets Manager: $0.40/secret/month × 3). Holds the things that must
survive a platform teardown — pushed images, uploaded cover images, secret values.

| Resource | Why it lives here |
|---|---|
| 3 × ECR repo (`eventide/{auth,event,registration}`) | Images built by CI must outlast the cluster. |
| S3 uploads bucket (`eventide-uploads-<account>`) | Cover images are re-seeded each rebuild, but the bucket + CORS policy shouldn't churn. |
| 3 × Secrets Manager secret (`eventide/{auth,event,registration}`) | Real secret values are entered once and must not be lost on teardown. |
| Route 53 hosted zone + ACM wildcard cert (`dns.tf`, opt-in) | The zone's NS records are delegated from Cloudflare **by hand, once** — recreating the zone changes the NS set and breaks the delegation. The cert DNS-validates once and is reused across every platform rebuild. |
| `eventide/google-oauth` secret (`oauth.tf`, opt-in) | Google OAuth client id/secret — stable across rebuilds, Terraform-managed from `google.auto.tfvars`. `scripts/deploy.sh` merges it into `eventide-auth`. |

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

## Custom domain (`dns.tf`) — optional, opt-in

Off unless `dns_domain` is set. `events.<domain>` is delegated to a Route 53 hosted
zone; the apex stays on Cloudflare (SYSTEM-DESIGN.md §5.5.1 option 2).

```bash
cp dns.auto.tfvars.example dns.auto.tfvars     # gitignored; set dns_domain
terraform -chdir=infra/terraform/10-foundation apply
terraform -chdir=infra/terraform/10-foundation output route53_name_servers
```

Paste those **4 NS records** into Cloudflare as `NS` records on the name `events`
(type NS, one row per server, not proxied). Then wait for propagation and check:

```bash
dig +short NS events.<domain>                  # should return the Route 53 servers
aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='events.<domain>']"
aws acm describe-certificate --region us-east-1 --certificate-arn "$(
  terraform -chdir=infra/terraform/10-foundation output -raw acm_certificate_arn)" \
  --query 'Certificate.Status'                 # PENDING_VALIDATION -> ISSUED
```

The cert issues on ACM's own retry once the NS delegation resolves — no second
apply. `20-platform` then picks up the zone ID + cert ARN from this layer's
remote state on the next `make up` and wires the NLB TLS listener + ALIAS record.

**This layer is never destroyed**, so the zone and its NS delegation are set once
and survive every nightly platform rebuild.

## Google OAuth (`oauth.tf`) — optional, opt-in

Off unless `google_client_id` + `google_client_secret` are set. When set, Terraform
creates the `eventide/google-oauth` secret; `scripts/deploy.sh` reads it into the
`eventide-auth` k8s Secret on the next `make deploy`.

```bash
cp google.auto.tfvars.example google.auto.tfvars   # gitignored; paste the client creds
terraform -chdir=infra/terraform/10-foundation apply
```

Register the redirect URI in Google Cloud Console (exact match, HTTPS, no wildcard):
`https://events.<domain>/api/auth/callback/google` and (for dev)
`http://localhost:3000/api/auth/callback/google`. Consent screen → **In production**,
scopes limited to `openid` / `email` / `profile` (SYSTEM-DESIGN §5.1.1).

## Overrides

Defaults target Learner Lab account `735838417080` / `us-east-1`. For a teammate's
account, either edit `variables.tf` defaults or pass `-var`:

```bash
terraform -chdir=infra/terraform/10-foundation apply \
  -var account_id=<id> -var region=us-east-1
```

...and update the `bucket` in `versions.tf` + re-run `00-bootstrap` there first.
