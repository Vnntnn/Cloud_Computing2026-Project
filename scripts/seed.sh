#!/usr/bin/env bash
# Demo seed against the DEPLOYED cluster. RDS is not publicly accessible, so the
# seed runs in-cluster as a one-off pod using the db-bootstrap image (it already
# carries scripts/seed.ts + postgres + drizzle-orm). Creates organizer/admin/
# attendee accounts plus catalog data, then purchases demo tickets
# through the in-cluster auth and registration Services.
#
# Local dev uses `make seed` instead (talks to the compose Postgres directly).
#
#   bash scripts/seed.sh          # tag = git short sha
#   bash scripts/seed.sh e923d44
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION=us-east-1
TAG="${1:-$(git rev-parse --short HEAD)}"
REG="$(terraform -chdir=infra/terraform/10-foundation output -raw ecr_registry)"
MASTER_SECRET_ARN="$(terraform -chdir=infra/terraform/20-platform output -raw rds_master_secret_arn)"

aws eks update-kubeconfig --region "$REGION" --name eventide >/dev/null

RDS_JSON="$(aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" \
  --query SecretString --output text)"
rds() { echo "$RDS_JSON" | jq -r ".$1"; }
HOST="$(rds host)"; PORT="$(rds port)"
AUTH_DB_URL="postgres://auth_svc:$(rds AUTH_SVC_PASSWORD)@${HOST}:${PORT}/auth_db?sslmode=require"
EVENT_URL="postgres://event_svc:$(rds EVENT_SVC_PASSWORD)@${HOST}:${PORT}/event_db?sslmode=require"
REG_URL="postgres://registration_svc:$(rds REGISTRATION_SVC_PASSWORD)@${HOST}:${PORT}/registration_db?sslmode=require"

kubectl -n eventide delete pod seed --ignore-not-found >/dev/null 2>&1
kubectl -n eventide run seed --restart=Never --attach --rm \
  --image="$REG/eventide/db-bootstrap:$TAG" \
  --overrides='{"apiVersion":"v1","spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":1000,"seccompProfile":{"type":"RuntimeDefault"}}}}' \
  --env="AUTH_URL=http://auth.eventide.svc.cluster.local" \
  --env="REGISTRATION_URL=http://registration.eventide.svc.cluster.local" \
  --env="PAYMENT_URL=http://payment.eventide.svc.cluster.local" \
  --env="AUTH_DATABASE_URL=$AUTH_DB_URL" \
  --env="EVENT_DATABASE_URL=$EVENT_URL" \
  --env="REGISTRATION_DATABASE_URL=$REG_URL" \
  --env="SEED_FORCE=${SEED_FORCE:-}" \
  --command -- bun scripts/seed.ts
