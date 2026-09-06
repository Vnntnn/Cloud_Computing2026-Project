#!/usr/bin/env bash
# Build → push → deploy the app to the running EKS cluster.
#
# CI/CD can't do this (the lab has no OIDC, session creds expire in 4h —
# SYSTEM-DESIGN.md §9), so deploy is a local script run with fresh credentials.
# The cluster + ingress-nginx come from `make up` (terraform); this only ships
# the app whose image changes every commit.
#
#   bash scripts/deploy.sh            # tag = git short sha
#   bash scripts/deploy.sh v1         # explicit tag
#   SERVICES="event auth" bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION=us-east-1
SERVICES="${SERVICES:-event}"   # add: auth registration — as they get manifests
TAG="${1:-$(git rev-parse --short HEAD)}"

REG="$(terraform -chdir=infra/terraform/10-foundation output -raw ecr_registry)"
echo "registry: $REG   tag: $TAG   services: $SERVICES"

aws eks update-kubeconfig --region "$REGION" --name eventide >/dev/null
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REG" >/dev/null

for svc in $SERVICES; do
  echo "== build $svc =="
  docker build -f "apps/$svc/Dockerfile" --platform linux/amd64 \
    -t "$REG/eventide/$svc:$TAG" .
  docker push "$REG/eventide/$svc:$TAG"
done

echo "== apply manifests =="
kubectl apply -f infra/k8s/

for svc in $SERVICES; do
  kubectl -n eventide set image "deployment/$svc" "$svc=$REG/eventide/$svc:$TAG"
  kubectl -n eventide rollout status "deployment/$svc" --timeout=120s
done

NLB="$(terraform -chdir=infra/terraform/20-platform output -raw nlb_dns_name)"
echo
echo "deployed. smoke test:"
echo "  curl http://$NLB/health/live"
echo "  curl http://$NLB/api/events"
