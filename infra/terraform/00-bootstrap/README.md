# 00-bootstrap — Terraform state backend

The S3 bucket that holds Terraform state for `10-foundation` and `20-platform`.

**This layer is not Terraform.** It is a chicken-and-egg problem — the backend
cannot store its own creation in itself — so it is two `aws s3api` commands run
by hand, once per AWS account, and never touched again. Do not build a module
for it (SYSTEM-DESIGN.md §7).

## Create it

Run these once, with lab session credentials in `~/.aws/credentials`:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="eventide-tfstate-${ACCOUNT_ID}"

aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

# defence in depth — the state file holds DB endpoints and secret ARNs
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

`us-east-1` is the one region that rejects `--create-bucket-configuration`; the
commands above are already correct for it. In any other region add
`--create-bucket-configuration LocationConstraint=<region>`.

## Verify

```bash
aws s3api head-bucket --bucket "eventide-tfstate-$(aws sts get-caller-identity --query Account --output text)"
```

## Locking

State locking uses S3 conditional writes (`use_lockfile = true`, Terraform
≥ 1.10) — **no DynamoDB table**. See the `backend "s3"` block in
`../10-foundation/versions.tf`.

## Note on account switching

The bucket name is account-scoped (`…-<ACCOUNT_ID>`). If the project falls back
to a teammate's Learner Lab account (see PROJECT-KNOWLEDGE-BASE.md §2), re-run
the commands above there and change `bucket = …` in both layers' backend blocks.
State does not carry over — a fresh account is a fresh build from zero, which is
the rehearsed path anyway.
