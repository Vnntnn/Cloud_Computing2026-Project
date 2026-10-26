#!/usr/bin/env bash
# One-time per account (idempotent): create the Terraform state bucket if it is
# missing and `terraform init` the single root against it. The bucket name is
# derived from the credentials in infra/aws.env, so nothing is hardcoded.
#
#   bash scripts/tf-init.sh        (make tf-init; `make up` runs it too)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"
load_aws_env

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="eventide-tfstate-${ACCOUNT}"
REGION="${AWS_DEFAULT_REGION}"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "== creating state bucket $BUCKET =="
  # us-east-1 rejects --create-bucket-configuration; other regions need it.
  if [ "$REGION" = "us-east-1" ]; then aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null; fi
  aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
fi

# 2026-10-24 carry-over: the pre-merge layout kept the permanent resources in
# `10-foundation/terraform.tfstate`. Same resource addresses at the new root, so
# the file is copied once; afterwards only `eventide/terraform.tfstate` is used.
if ! aws s3api head-object --bucket "$BUCKET" --key eventide/terraform.tfstate >/dev/null 2>&1 \
   && aws s3api head-object --bucket "$BUCKET" --key 10-foundation/terraform.tfstate >/dev/null 2>&1; then
  echo "== carrying over 10-foundation/terraform.tfstate -> eventide/terraform.tfstate =="
  aws s3 cp "s3://$BUCKET/10-foundation/terraform.tfstate" "s3://$BUCKET/eventide/terraform.tfstate" >/dev/null
fi

echo "== terraform init (bucket=$BUCKET) =="
tf init -input=false -backend-config="bucket=$BUCKET"

# an interrupted run (credentials cut mid-apply) leaves errored.tfstate and a stale lock: fix them
# before anything reads or writes the state (scripts/recover-state.sh)
echo "== recover an interrupted state (if any) =="
bash "$ROOT/scripts/recover-state.sh"
