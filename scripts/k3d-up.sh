#!/usr/bin/env bash
# Local EKS stand-in: a k3d cluster running the SAME infra/k8s manifests the
# real cluster runs (week 1 Day 4 — local/prod parity GATE).
#
# The mapping to the AWS session lifecycle:
#
#   make up      ->  k3d cluster create + helm install ingress-nginx   (this script, top half)
#   make deploy  ->  docker build -> push to k3d registry -> kubectl apply  (this script, bottom half)
#   make down    ->  k3d cluster delete                                (scripts/k3d-down.sh)
#
# ingress-nginx uses the same values file as 20-platform/addons.tf, plus a small
# k3d overlay (infra/helm/ingress-nginx.values.local.yaml). The APP manifests are
# byte-identical — that is the whole point of the exercise.
#
#   bash scripts/k3d-up.sh            # tag = git short sha
#   bash scripts/k3d-up.sh local     # explicit tag
#   SERVICES="event auth" bash scripts/k3d-up.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CLUSTER=eventide
REG_PORT=5111                              # host -> k3d registry (container :5000)
REG_INCLUSTER="eventide-registry:${REG_PORT}"
INGRESS_VERSION=4.15.1
INGRESS_IMAGE="registry.k8s.io/ingress-nginx/controller:v1.15.1"  # chart 4.15.1's appVersion
SERVICES="${SERVICES:-event}"
TAG="${1:-$(git rev-parse --short HEAD)}"

# --- cluster (idempotent) ------------------------------------------------
if k3d cluster list -o json | grep -q "\"name\":\"${CLUSTER}\""; then
  echo "== k3d cluster '${CLUSTER}' already exists =="
else
  echo "== create k3d cluster '${CLUSTER}' =="
  k3d cluster create "${CLUSTER}" \
    --agents 2 \
    --registry-create "eventide-registry:0.0.0.0:${REG_PORT}" \
    --k3s-arg "--disable=traefik@server:*" \
    --port "8080:30080@loadbalancer" \
    --port "8443:30443@loadbalancer" \
    --wait
fi

kubectl config use-context "k3d-${CLUSTER}" >/dev/null

# --- ingress-nginx (same values as EKS + k3d overlay) ------------------
# Pre-load the controller image via the host Docker cache. registry.k8s.io is
# slow from here (~4 min for the 110 MB image) and the pull happens inside every
# fresh k3d node — importing it once keeps `make k3d` under a minute on reruns
# and off the critical path of the helm --wait.
echo "== preload ${INGRESS_IMAGE} into k3d =="
docker image inspect "${INGRESS_IMAGE}" >/dev/null 2>&1 || docker pull "${INGRESS_IMAGE}"
k3d image import "${INGRESS_IMAGE}" -c "${CLUSTER}"

echo "== helm install ingress-nginx =="
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
helm repo update ingress-nginx >/dev/null
# A prior run that timed out on the (slow, ~110 MB) controller image pull leaves
# the release wedged in `pending-install`/`failed` — clear it before retrying.
case "$(helm -n ingress-nginx status ingress-nginx -o json 2>/dev/null \
        | grep -o '"status":"[a-z-]*"' | head -1)" in
  *pending-install*|*failed*) helm -n ingress-nginx uninstall ingress-nginx || true ;;
esac
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --version "${INGRESS_VERSION}" \
  --namespace ingress-nginx --create-namespace \
  -f infra/helm/ingress-nginx.values.yaml \
  -f infra/helm/ingress-nginx.values.local.yaml \
  --wait --timeout 8m

# --- build -> push to the k3d registry --------------------------------
for svc in $SERVICES; do
  echo "== build $svc (native arch, no --platform — k3d nodes match the host) =="
  docker build -f "apps/$svc/Dockerfile" -t "localhost:${REG_PORT}/eventide/$svc:$TAG" .
  docker push "localhost:${REG_PORT}/eventide/$svc:$TAG"
done

# --- apply the SAME manifests ----------------------------------------
echo "== kubectl apply -f infra/k8s/ =="
kubectl apply -f infra/k8s/event.yaml

for svc in $SERVICES; do
  kubectl -n eventide set image "deployment/$svc" \
    "$svc=${REG_INCLUSTER}/eventide/$svc:$TAG"
  kubectl -n eventide rollout status "deployment/$svc" --timeout=120s
done

echo
echo "deployed to k3d. smoke test (same paths as the NLB GATE on EKS):"
echo "  curl -s http://localhost:8080/health/live   # {\"status\":\"ok\",\"service\":\"event\"}"
echo "  curl -s http://localhost:8080/api/events    # []"
echo "  open  http://localhost:8080/swagger"
