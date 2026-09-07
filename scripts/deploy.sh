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
# Secrets (ESO path): this script writes the real per-rebuild runtime env (fresh
# RDS host + passwords, better-auth key, S3 creds) into the
# eventide/{auth,event,registration} Secrets Manager secrets, then deploys with
# eso.enabled=true. The External Secrets Operator (installed by `make up`,
# 20-platform/addons.tf) syncs those into the eventide-<svc> k8s Secrets the pods
# read via envFrom. ESO authenticates with the session credentials in
# `eventide-aws-creds` — the node role has no secretsmanager access and
# iam:AttachRolePolicy is denied (§5.3), so this Secret is refreshed each run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION=us-east-1
SERVICES="${SERVICES:-auth event registration web}"
TAG="${1:-$(git rev-parse --short HEAD)}"

REG="$(terraform -chdir=infra/terraform/10-foundation output -raw ecr_registry)"
MASTER_SECRET_ARN="$(terraform -chdir=infra/terraform/20-platform output -raw rds_master_secret_arn)"
NLB="$(terraform -chdir=infra/terraform/20-platform output -raw nlb_dns_name)"
# JWT iss/aud + BETTER_AUTH_URL. Prefer the custom domain (Route 53 + ACM, wired
# in 10-foundation); fall back to the bare NLB over http until DNS lands.
PUBLIC_URL_TF="$(terraform -chdir=infra/terraform/20-platform output -raw public_url 2>/dev/null || true)"
PUBLIC_URL="${PUBLIC_URL:-${PUBLIC_URL_TF:-http://$NLB}}"

echo "registry: $REG   tag: $TAG   services: $SERVICES   publicUrl: $PUBLIC_URL"

aws eks update-kubeconfig --region "$REGION" --name eventide >/dev/null
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REG" >/dev/null

for svc in $SERVICES; do
  echo "== build $svc =="
  docker build -f "apps/$svc/Dockerfile" --platform linux/amd64 -t "$REG/eventide/$svc:$TAG" .
  docker push "$REG/eventide/$svc:$TAG"
done

# --- namespace -------------------------------------------------------
kubectl create namespace eventide --dry-run=client -o yaml | kubectl apply -f -

# --- assemble the real values from eventide/rds-master ---------------
RDS_JSON="$(aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" \
  --query SecretString --output text)"
rds() { echo "$RDS_JSON" | jq -r ".$1"; }
HOST="$(rds host)"; PORT="$(rds port)"
# 48-char key-encryption key for better-auth's JWKS — from the rds-master secret
# (20-platform/rds.tf), regenerated on every rebuild alongside auth_db.
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(rds BETTER_AUTH_SECRET)}"
UPLOADS_BUCKET="$(terraform -chdir=infra/terraform/10-foundation output -raw uploads_bucket)"
CREDS="$(aws configure export-credentials --format process 2>/dev/null || true)"
cred() { echo "$CREDS" | jq -r ".$1 // empty"; }

# ?sslmode=require — RDS PG16 forces SSL (rds.force_ssl=1); `require` encrypts
# without verifying the cert, which is fine inside the VPC.
SSL="?sslmode=require"
dsn() { # dsn <svc>  ->  postgres://<svc>_svc:<pw>@host:port/<svc>_db?sslmode=require
  local svc="$1" pw
  pw="$(rds "$(echo "$svc" | tr '[:lower:]' '[:upper:]')_SVC_PASSWORD")"
  echo "postgres://${svc}_svc:${pw}@${HOST}:${PORT}/${svc}_db${SSL}"
}

# --- write the per-service runtime env into Secrets Manager ---------
# The eventide/<svc> secrets exist (placeholder) from 10-foundation; ESO syncs
# whatever we put here. `event` carries the session's AWS creds (S3 presigning —
# the app's one AWS touch-point, §5.3), so this must re-run every session.
put() { aws secretsmanager put-secret-value --region "$REGION" \
  --secret-id "$1" --secret-string "$2" >/dev/null && echo "  put $1"; }

put eventide/auth "$(jq -nc \
  --arg DATABASE_URL "$(dsn auth)" \
  --arg BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET" \
  '$ARGS.named')"
put eventide/event "$(jq -nc \
  --arg DATABASE_URL "$(dsn event)" \
  --arg S3_BUCKET_NAME "$UPLOADS_BUCKET" \
  --arg S3_REGION "$REGION" \
  --arg AWS_ACCESS_KEY_ID "$(cred AccessKeyId)" \
  --arg AWS_SECRET_ACCESS_KEY "$(cred SecretAccessKey)" \
  --arg AWS_SESSION_TOKEN "$(cred SessionToken)" \
  '$ARGS.named')"
put eventide/registration "$(jq -nc \
  --arg DATABASE_URL "$(dsn registration)" \
  '$ARGS.named')"

# --- ESO's own AWS credentials (session creds, ~4h TTL, refreshed here) ---
kubectl -n eventide create secret generic eventide-aws-creds \
  --from-literal=AWS_ACCESS_KEY_ID="$(cred AccessKeyId)" \
  --from-literal=AWS_SECRET_ACCESS_KEY="$(cred SecretAccessKey)" \
  --from-literal=AWS_SESSION_TOKEN="$(cred SessionToken)" \
  --dry-run=client -o yaml | kubectl apply -f -

# --- deploy the chart -----------------------------------------------
echo "== helm upgrade --install eventide =="
# No --wait: on a first install the pods stay pending until ESO has created the
# eventide-<svc> Secrets, which happens after helm returns.
helm upgrade --install eventide infra/helm/eventide \
  -f infra/helm/eventide/values.yaml \
  -f infra/helm/eventide/values.aws.yaml \
  --set imageRegistry="$REG" \
  --set publicUrl="$PUBLIC_URL" \
  $(for s in $SERVICES; do echo --set services.$s.image.tag=$TAG; done) \
  --timeout 420s

echo "== wait for ESO to sync the service Secrets =="
kubectl -n eventide wait --for=condition=Ready externalsecret --all --timeout=180s

# envFrom does not re-read a Secret in a running pod — roll the deployments onto
# the fresh values (also covers a redeploy where the image tag didn't change).
kubectl -n eventide rollout restart deployment -l app.kubernetes.io/part-of=eventide

for svc in $SERVICES; do
  kubectl -n eventide rollout status "deployment/$svc" --timeout=180s
done

echo
echo "deployed. smoke test:"
echo "  curl http://$NLB/health/live       # {\"status\":\"ok\",\"service\":\"event\"}"
echo "  curl http://$NLB/api/events"
echo "  curl http://$NLB/api/auth/jwks"
case "$PUBLIC_URL" in
  https://*) echo "  curl $PUBLIC_URL/health/live       # via Route 53 + ACM (once DNS propagates)";;
esac
echo "  # migrations: bash scripts/db-bootstrap.sh   ·   seed: bash scripts/seed.sh"
