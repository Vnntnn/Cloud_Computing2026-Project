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
# Secrets directly from `eventide/rds-master` (the same source the db-bootstrap
# Job uses), plus `eventide/google-oauth` into eventide-auth if that secret
# exists (10-foundation/oauth.tf), and deploys with eso.enabled=false. The chart
# keeps the ESO templates behind that toggle — see SYSTEM-DESIGN §5.2.1 for why
# they stay disabled in the lab.
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

# Google OAuth (optional). eventide/google-oauth is Terraform-managed in
# 10-foundation from google_client_id / google_client_secret (oauth.tf). Absent →
# auth runs email/password only (SYSTEM-DESIGN §5.1.1).
AUTH_ARGS=(
  --from-literal=DATABASE_URL="postgres://auth_svc:$(rds AUTH_SVC_PASSWORD)@${HOST}:${PORT}/auth_db${SSL}"
  --from-literal=BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
)
GOOGLE_JSON="$(aws secretsmanager get-secret-value --region "$REGION" \
  --secret-id eventide/google-oauth --query SecretString --output text 2>/dev/null || true)"
if [ -n "$GOOGLE_JSON" ]; then
  AUTH_ARGS+=(--from-literal=GOOGLE_CLIENT_ID="$(echo "$GOOGLE_JSON" | jq -r .GOOGLE_CLIENT_ID)")
  AUTH_ARGS+=(--from-literal=GOOGLE_CLIENT_SECRET="$(echo "$GOOGLE_JSON" | jq -r .GOOGLE_CLIENT_SECRET)")
  echo "google oauth: enabled"
fi
mksecret eventide-auth "${AUTH_ARGS[@]}"
# event also gets S3: the uploads bucket name + the current session's AWS
# credentials (the app's one AWS touch-point — presigning cover-image URLs;
# IRSA and node-role access are both denied, §5.3). These expire with the
# session — re-run `make deploy` (or just this block) each session.
UPLOADS_BUCKET="$(terraform -chdir=infra/terraform/10-foundation output -raw uploads_bucket)"
CREDS="$(aws configure export-credentials --format process 2>/dev/null || true)"
cred() { echo "$CREDS" | jq -r ".$1 // empty"; }
mksecret eventide-event \
  --from-literal=DATABASE_URL="postgres://event_svc:$(rds EVENT_SVC_PASSWORD)@${HOST}:${PORT}/event_db${SSL}" \
  --from-literal=S3_BUCKET_NAME="$UPLOADS_BUCKET" \
  --from-literal=S3_REGION="$REGION" \
  --from-literal=AWS_ACCESS_KEY_ID="$(cred AccessKeyId)" \
  --from-literal=AWS_SECRET_ACCESS_KEY="$(cred SecretAccessKey)" \
  --from-literal=AWS_SESSION_TOKEN="$(cred SessionToken)"
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
case "$PUBLIC_URL" in
  https://*) echo "  curl $PUBLIC_URL/health/live       # via Route 53 + ACM (once DNS propagates)";;
esac
echo "  # migrations: bash scripts/db-bootstrap.sh   ·   seed: bash scripts/seed.sh"
