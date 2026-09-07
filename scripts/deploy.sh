#!/usr/bin/env bash
# Build → push → deploy the app to the running EKS cluster via the Helm chart
# (infra/helm/eventide, values-aws overlay).
#
# CI/CD can't do this (the lab has no OIDC, session creds expire in 4h —
# SYSTEM-DESIGN.md §9), so deploy is a local script run with fresh credentials.
# The cluster + ingress-nginx come from `make up` (Terraform); this ships the
# app whose image changes every commit.
#
#   bash scripts/deploy.sh            # tag = git short sha
#   bash scripts/deploy.sh v1         # explicit tag
#   SERVICES="event auth" bash scripts/deploy.sh
#
# Secrets: this script assembles the eventide-{auth,event,registration} k8s
# Secrets from `eventide/rds-master` (the same source the db-bootstrap Job uses)
# and deploys with eso.enabled=false.
#   TODO: the ESO path wants 20-platform to also write the assembled DATABASE_URLs
#   into the per-service `eventide/<svc>` Secrets Manager secrets on every rebuild
#   (BETTER_AUTH_SECRET is already in rds-master); then `--set eso.enabled=true`
#   and drop the mksecret block below.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION=us-east-1
SERVICES="${SERVICES:-auth event registration web}"
TAG="${1:-$(git rev-parse --short HEAD)}"

REG="$(terraform -chdir=infra/terraform/10-foundation output -raw ecr_registry)"
MASTER_SECRET_ARN="$(terraform -chdir=infra/terraform/20-platform output -raw rds_master_secret_arn)"
NLB="$(terraform -chdir=infra/terraform/20-platform output -raw nlb_dns_name)"
PUBLIC_URL="${PUBLIC_URL:-http://$NLB}"   # JWT iss/aud; set to https://<domain> once DNS lands

echo "registry: $REG   tag: $TAG   services: $SERVICES   publicUrl: $PUBLIC_URL"

aws eks update-kubeconfig --region "$REGION" --name eventide >/dev/null
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REG" >/dev/null

for svc in $SERVICES; do
  echo "== build $svc =="
  docker build -f "apps/$svc/Dockerfile" --platform linux/amd64 -t "$REG/eventide/$svc:$TAG" .
  docker push "$REG/eventide/$svc:$TAG"
done

# --- namespace + app Secrets from eventide/rds-master ------------------
kubectl create namespace eventide --dry-run=client -o yaml | kubectl apply -f -

RDS_JSON="$(aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" \
  --query SecretString --output text)"
rds() { echo "$RDS_JSON" | jq -r ".$1"; }
HOST="$(rds host)"; PORT="$(rds port)"
# 48-char key-encryption key for better-auth's JWKS — from the rds-master secret
# (20-platform/rds.tf), regenerated on every rebuild alongside auth_db.
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(rds BETTER_AUTH_SECRET)}"

mksecret() { kubectl -n eventide create secret generic "$1" "${@:2}" \
  --dry-run=client -o yaml | kubectl apply -f -; }
# ?sslmode=require — RDS PG16 forces SSL (rds.force_ssl=1); `require` encrypts
# without verifying the cert, which is fine inside the VPC.
SSL="?sslmode=require"
mksecret eventide-auth \
  --from-literal=DATABASE_URL="postgres://auth_svc:$(rds AUTH_SVC_PASSWORD)@${HOST}:${PORT}/auth_db${SSL}" \
  --from-literal=BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
mksecret eventide-event \
  --from-literal=DATABASE_URL="postgres://event_svc:$(rds EVENT_SVC_PASSWORD)@${HOST}:${PORT}/event_db${SSL}"
mksecret eventide-registration \
  --from-literal=DATABASE_URL="postgres://registration_svc:$(rds REGISTRATION_SVC_PASSWORD)@${HOST}:${PORT}/registration_db${SSL}"

# --- deploy the chart -------------------------------------------------
echo "== helm upgrade --install eventide =="
helm upgrade --install eventide infra/helm/eventide \
  -f infra/helm/eventide/values.yaml \
  -f infra/helm/eventide/values.aws.yaml \
  --set imageRegistry="$REG" \
  --set publicUrl="$PUBLIC_URL" \
  --set eso.enabled=false \
  $(for s in $SERVICES; do echo --set services.$s.image.tag=$TAG; done) \
  --wait --timeout 420s

for svc in $SERVICES; do
  kubectl -n eventide rollout status "deployment/$svc" --timeout=180s
done

echo
echo "deployed. smoke test:"
echo "  curl http://$NLB/health/live       # {\"status\":\"ok\",\"service\":\"event\"}"
echo "  curl http://$NLB/api/events"
echo "  curl http://$NLB/api/auth/jwks"
echo "  # migrations: bash scripts/db-bootstrap.sh   ·   seed: bash scripts/seed.sh"
