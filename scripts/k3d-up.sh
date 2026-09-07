#!/usr/bin/env bash
# Local EKS stand-in: a k3d cluster running the SAME Helm chart the real cluster
# runs (infra/helm/eventide), with the k3d overlay (values.local.yaml).
#
# The mapping to the AWS session lifecycle:
#
#   make up      ->  k3d cluster create + helm install ingress-nginx   (this script, top half)
#   make deploy  ->  docker build -> push to k3d registry -> helm upgrade  (this script, bottom half)
#   make down    ->  k3d cluster delete                                (scripts/k3d-down.sh)
#
# ingress-nginx uses the same values file as 20-platform/addons.tf plus the k3d
# overlay. The APP is the same chart as EKS — only values-local vs values-aws and
# the image registry differ. That is the whole point of the exercise.
#
# The three service databases live in the host `docker compose` Postgres; the
# in-cluster pods reach it at host.k3d.internal:5432. On EKS this is RDS, filled
# by the db-bootstrap Job; here `packages/db` bootstrap runs from the host.
#
#   bash scripts/k3d-up.sh            # tag = git short sha
#   bash scripts/k3d-up.sh local     # explicit tag
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CLUSTER=eventide
REG_PORT=5111                              # host -> k3d registry (container :5000)
REG_INCLUSTER="eventide-registry:${REG_PORT}"
INGRESS_VERSION=4.15.1
INGRESS_IMAGE="registry.k8s.io/ingress-nginx/controller:v1.15.1"  # chart 4.15.1's appVersion
SERVICES="auth event registration web"
TAG="${1:-$(git rev-parse --short HEAD)}"

# Must match apps/auth/src/env.ts's dev default so the auth_db.jwks row created
# by `make dev` stays decryptable under `make k3d` (and vice versa).
BETTER_AUTH_SECRET="dev-only-insecure-better-auth-secret-0000000"
DB_HOST_INCLUSTER="host.k3d.internal"

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
echo "== preload ${INGRESS_IMAGE} into k3d =="
docker image inspect "${INGRESS_IMAGE}" >/dev/null 2>&1 || docker pull "${INGRESS_IMAGE}"
k3d image import "${INGRESS_IMAGE}" -c "${CLUSTER}"

echo "== helm install ingress-nginx =="
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
helm repo update ingress-nginx >/dev/null
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

# --- databases: host compose Postgres + migrations --------------------
echo "== host Postgres + bootstrap (auth_db / event_db / registration_db) =="
docker compose up -d db
printf 'waiting for postgres'
until docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; do printf '.'; sleep 1; done
echo
bun run --filter @eventide/db db:bootstrap

# --- build -> push to the k3d registry --------------------------------
for svc in $SERVICES; do
  echo "== build $svc (native arch, no --platform — k3d nodes match the host) =="
  docker build -f "apps/$svc/Dockerfile" -t "localhost:${REG_PORT}/eventide/$svc:$TAG" .
  docker push "localhost:${REG_PORT}/eventide/$svc:$TAG"
done

# --- app Secrets (ESO's job on EKS; a local file here — SYSTEM-DESIGN §5.2) ---
echo "== eventide-{auth,event,registration} Secrets =="
kubectl create namespace eventide --dry-run=client -o yaml | kubectl apply -f -
mksecret() { kubectl -n eventide create secret generic "$1" "${@:2}" \
  --dry-run=client -o yaml | kubectl apply -f -; }
mksecret eventide-auth \
  --from-literal=DATABASE_URL="postgres://auth_svc:auth_svc@${DB_HOST_INCLUSTER}:5432/auth_db" \
  --from-literal=BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
mksecret eventide-event \
  --from-literal=DATABASE_URL="postgres://event_svc:event_svc@${DB_HOST_INCLUSTER}:5432/event_db"
mksecret eventide-registration \
  --from-literal=DATABASE_URL="postgres://registration_svc:registration_svc@${DB_HOST_INCLUSTER}:5432/registration_db"

# --- deploy the chart (same chart as EKS, values-local overlay) -------
echo "== helm upgrade --install eventide =="
helm upgrade --install eventide infra/helm/eventide \
  -f infra/helm/eventide/values.yaml \
  -f infra/helm/eventide/values.local.yaml \
  --set imageRegistry="${REG_INCLUSTER}" \
  $(for s in $SERVICES; do echo --set services.$s.image.tag=$TAG; done) \
  --wait --timeout 180s

echo
echo "deployed to k3d. smoke test (same paths as the NLB GATE on EKS):"
echo "  curl -s http://localhost:8080/health/live                 # {\"status\":\"ok\",\"service\":\"event\"}"
echo "  curl -s http://localhost:8080/api/events | jq length      # seeded events (run: make seed)"
echo "  curl -s http://localhost:8080/api/auth/jwks               # EdDSA public key"
echo "  open  http://localhost:8080/swagger"
