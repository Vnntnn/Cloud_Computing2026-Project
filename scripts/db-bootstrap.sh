#!/usr/bin/env bash
# Create the 3 service databases + owner roles on RDS and run the migrations, as
# a one-shot in-cluster Job. Idempotent — safe to re-run every session after
# `make up`. Week-1 Day-4 GATE.
#
# Pre-ESO stand-in: builds the `eventide-rds-master` k8s Secret from
# `terraform output`. Week 2 an ExternalSecret replaces this half.
#
#   bash scripts/db-bootstrap.sh          # tag = git short sha
#   bash scripts/db-bootstrap.sh v1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION=us-east-1
TAG="${1:-$(git rev-parse --short HEAD)}"
REG="$(terraform -chdir=infra/terraform/10-foundation output -raw ecr_registry)"
SECRET_ARN="$(terraform -chdir=infra/terraform/20-platform output -raw rds_master_secret_arn)"

aws eks update-kubeconfig --region "$REGION" --name eventide >/dev/null
kubectl create namespace eventide --dry-run=client -o yaml | kubectl apply -f -

echo "== eventide-rds-master Secret from Secrets Manager =="
KV=()   # bash 3.2 (macOS) has no mapfile
while IFS= read -r line; do KV+=("$line"); done < <(
  aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" \
    --query SecretString --output text \
  | jq -r 'to_entries[] | "--from-literal=\(.key)=\(.value)"'
)
kubectl -n eventide create secret generic eventide-rds-master "${KV[@]}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== build + push db-bootstrap:$TAG =="
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REG" >/dev/null
docker build -f packages/db/Dockerfile --platform linux/amd64 \
  -t "$REG/eventide/db-bootstrap:$TAG" .
docker push "$REG/eventide/db-bootstrap:$TAG"

echo "== run the Job (pod template is immutable — sed the image, recreate) =="
kubectl -n eventide delete job db-bootstrap --ignore-not-found
sed "s|PLACEHOLDER_DB_BOOTSTRAP_IMAGE|$REG/eventide/db-bootstrap:$TAG|" \
  infra/k8s/db-bootstrap.job.yaml | kubectl apply -f -

kubectl -n eventide wait --for=condition=complete job/db-bootstrap --timeout=180s \
  || { kubectl -n eventide logs job/db-bootstrap; exit 1; }
kubectl -n eventide logs job/db-bootstrap
echo "db-bootstrap complete"
