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
# ingress-nginx uses the same values file as infra/terraform/platform.tf plus the k3d
# overlay. The APP is the same chart as EKS — only values-local vs values-aws and
# the image registry differ. That is the whole point of the exercise.
#
# Postgres, Redis (unused by the chart — it runs its own redis pod), ElasticMQ and
# MinIO come from the host `docker compose` (BIND_HOST=0.0.0.0 so the pods can
# reach them at host.k3d.internal). On EKS these are RDS / SQS / S3. The chart's
# db-migrate hook migrates the database in both places.
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
IMAGES="${IMAGES:-auth event registration payment mail-worker web db-bootstrap}"
. "$ROOT/scripts/lib.sh"
TAG="${1:-$(git rev-parse --short HEAD)}"

# Dev-only values (match .env.example so `make dev` and `make k3d` share a database).
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-dev-only-insecure-better-auth-secret-0000000}"
H="host.k3d.internal" # the docker host, as the pods see it

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
# No `k3d image import` preload: with Docker's containerd image store it fails
# ("ctr: content digest … not found" on a multi-platform `docker save`), and the
# nodes pull registry.k8s.io directly anyway.
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

# --- host services: Postgres / Redis / ElasticMQ / MinIO ---------------------
echo "== docker compose (BIND_HOST=0.0.0.0 so the pods can reach the host) =="
BIND_HOST=0.0.0.0 docker compose up -d
printf 'waiting for postgres'
until docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; do printf '.'; sleep 1; done
echo
docker compose wait minio-init >/dev/null 2>&1 || true   # one-shot bucket + public/* policy

# --- build -> push to the k3d registry ------------------------------------
for img in $IMAGES; do
  echo "== build $img (native arch, no --platform — k3d nodes match the host) =="
  docker build -f "$(dockerfile_for "$img")" -t "localhost:${REG_PORT}/eventide/$img:$TAG" .
  docker push "localhost:${REG_PORT}/eventide/$img:$TAG"
done

# --- app Secrets (deploy.sh's job on EKS; dev values here — SYSTEM-DESIGN §5.2) ---
echo "== eventide-{common,auth,payment,mail-worker} Secrets =="
kubectl create namespace eventide --dry-run=client -o yaml | kubectl apply -f -
mksecret() { kubectl -n eventide create secret generic "$1" "${@:2}" \
  --dry-run=client -o yaml | kubectl apply -f -; }
mksecret eventide-common \
  --from-literal=DATABASE_URL="postgres://postgres:postgres@${H}:5432/db" \
  --from-literal=S3_ENDPOINT="http://${H}:9000" \
  --from-literal=S3_FORCE_PATH_STYLE="true" \
  --from-literal=S3_REGION="us-east-1" \
  --from-literal=S3_BUCKET="event-assets" \
  --from-literal=S3_ACCESS_KEY_ID="minioadmin" \
  --from-literal=S3_SECRET_ACCESS_KEY="minioadmin" \
  --from-literal=AWS_REGION="ap-southeast-1" \
  --from-literal=AWS_ACCESS_KEY_ID="local" \
  --from-literal=AWS_SECRET_ACCESS_KEY="local" \
  --from-literal=SQS_ENDPOINT="http://${H}:9324" \
  --from-literal=MAIL_QUEUE_URL="http://${H}:9324/000000000000/mail-queue"
# The payment release gate runs here, before the other Secrets are touched (the preflight pod needs only the common one).
case " $IMAGES " in
  *" payment "*) PAYMENT_IMAGE="${REG_INCLUSTER}/eventide/payment:$TAG" ;;
  *) PAYMENT_IMAGE="$(payment_running_image 2>/dev/null || true)" ;;
esac
echo "== payment preflight =="
payment_gate upgrade "$PAYMENT_IMAGE" || { echo "nothing was deployed"; exit 1; }
mksecret eventide-auth \
  --from-literal=BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}"
mksecret eventide-payment \
  --from-literal=STRIPE_SECRET_KEY="" \
  --from-literal=STRIPE_WEBHOOK_SECRET=""
mksecret eventide-mail-worker \
  --from-literal=GMAIL_USER="" \
  --from-literal=GMAIL_APP_PASSWORD="" \
  --from-literal=MAIL_FROM=""

# --- deploy the chart (same chart as EKS, values-local overlay), through the payment release gate (scripts/lib.sh) -------
echo "== release (payment preflight, then helm upgrade --install eventide; db-migrate hook runs first) =="
release_upgrade values.local.yaml "$PAYMENT_IMAGE" 300s \
  --set imageRegistry="${REG_INCLUSTER}" \
  $(helm_tag_sets "$TAG" $IMAGES) $(keep_sets $IMAGES) \
  || exit 1

echo
echo "deployed to k3d. smoke test (same paths as the NLB GATE on EKS):"
for p in auth events regis payment; do echo "  curl -s http://localhost:8080/api/$p/health   # โอเค"; done
echo "  open  http://localhost:8080"
echo "  make admin EMAIL=<registered email>          # first admin"
