#!/usr/bin/env bash
# Build → push → deploy the app to the running EKS cluster via the Helm chart
# (infra/helm/eventide, values-aws overlay).
#
# CI/CD can't do this (the lab has no OIDC, session creds expire in 4h —
# SYSTEM-DESIGN.md §9), so deploy is a local script run with fresh credentials.
# The cluster + ingress-nginx come from `make up` (Terraform); this ships the
# app whose image changes every commit, and migrates the database first (the
# chart's db-migrate pre-upgrade hook).
#
#   bash scripts/deploy.sh            # tag = git short sha
#   bash scripts/deploy.sh v1         # explicit tag
#   IMAGES="event web" bash scripts/deploy.sh
#
# Secrets — four k8s Secrets assembled here every session (ESO stays off in the
# lab, SYSTEM-DESIGN §5.2.1; the app only ever reads process.env):
#   eventide-common       DATABASE_URL, S3_BUCKET, S3_REGION, AWS_REGION, AWS_* session
#                         creds, MAIL_QUEUE_URL     <- eventide/rds-master, terraform outputs,
#                                                     `aws configure export-credentials`
#   eventide-auth         BETTER_AUTH_SECRET (+ GOOGLE_*)        <- rds-master, eventide/google-oauth
#   eventide-payment      STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET <- eventide/stripe   ("" = payment off)
#   eventide-mail-worker  GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_FROM <- eventide/gmail  ("" = dry-run)
# The AWS session creds (S3 + SQS from the pods) expire with the lab session —
# re-run `make deploy` each session.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION=us-east-1
# Every image by default. A subset (IMAGES="event web") builds, pushes AND pins
# only those; the other Deployments keep their current tag (scripts/lib.sh).
IMAGES="${IMAGES:-auth event registration payment mail-worker web db-bootstrap}"
TAG="${1:-$(git rev-parse --short HEAD)}"
. "$ROOT/scripts/lib.sh"
load_aws_env

REG="$(tfout ecr_registry)"
UPLOADS_BUCKET="$(tfout uploads_bucket)"
MAIL_QUEUE_URL="$(tfout mail_queue_url)"
GOOGLE_SECRET="$(tfout google_oauth_secret || true)"
STRIPE_SECRET="$(tfout stripe_secret || true)"
GMAIL_SECRET="$(tfout gmail_secret || true)"
MASTER_SECRET_ARN="$(tfout rds_master_secret_arn)"
NLB="$(tfout nlb_dns_name)"
[ -n "$NLB" ] || { echo "no platform in the Terraform state — run \`make up\` first"; exit 1; }
# BETTER_AUTH_URL (cookies, OAuth callbacks). Prefer the custom domain (Route 53 +
# ACM, infra/terraform/dns.tf); fall back to the bare NLB over http until DNS lands.
PUBLIC_URL_TF="$(tfout public_url || true)"
PUBLIC_URL="${PUBLIC_URL:-${PUBLIC_URL_TF:-http://$NLB}}"

echo "registry: $REG   tag: $TAG   images: $IMAGES   publicUrl: $PUBLIC_URL"

aws eks update-kubeconfig --region "$REGION" --name eventide >/dev/null
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REG" >/dev/null

for img in $IMAGES; do
  echo "== build $img =="
  docker build -f "$(dockerfile_for "$img")" --platform linux/amd64 -t "$REG/eventide/$img:$TAG" .
  docker push "$REG/eventide/$img:$TAG"
done

# --- Secrets ---------------------------------------------------------------
kubectl create namespace eventide --dry-run=client -o yaml | kubectl apply -f -
mksecret() { kubectl -n eventide create secret generic "$1" "${@:2}" \
  --dry-run=client -o yaml | kubectl apply -f -; }
sm() { aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" \
  --query SecretString --output text; }
jkey() { echo "$1" | jq -r ".$2 // empty"; } # key of a JSON secret, "" when absent

RDS_JSON="$(sm "$MASTER_SECRET_ARN")"
CREDS="$(aws configure export-credentials --format process)"
mksecret eventide-common \
  --from-literal=DATABASE_URL="$(jkey "$RDS_JSON" DATABASE_URL)" \
  --from-literal=S3_BUCKET="$UPLOADS_BUCKET" \
  --from-literal=S3_REGION="$REGION" \
  --from-literal=AWS_REGION="$REGION" \
  --from-literal=AWS_ACCESS_KEY_ID="$(jkey "$CREDS" AccessKeyId)" \
  --from-literal=AWS_SECRET_ACCESS_KEY="$(jkey "$CREDS" SecretAccessKey)" \
  --from-literal=AWS_SESSION_TOKEN="$(jkey "$CREDS" SessionToken)" \
  --from-literal=MAIL_QUEUE_URL="$MAIL_QUEUE_URL"

# The payment release gate runs here: before the auth, payment and mail Secrets are touched (the preflight pod needs only the common
# Secret above), so a blocked release leaves what the running pods read on their next restart as it was.
case " $IMAGES " in
  *" payment "*) PAYMENT_IMAGE="$REG/eventide/payment:$TAG" ;;
  *) PAYMENT_IMAGE="$(payment_running_image 2>/dev/null || true)" ;;
esac
echo "== payment preflight =="
payment_gate upgrade "$PAYMENT_IMAGE" || { echo "nothing was deployed"; exit 1; }

AUTH_ARGS=(--from-literal=BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(jkey "$RDS_JSON" BETTER_AUTH_SECRET)}")
# Google rejects redirect URIs that are not HTTPS (localhost aside), so the button
# would only ever fail on the bare http://<nlb> origin: enable it once the custom
# domain serves HTTPS.
case "$PUBLIC_URL" in https://*) ;; *) GOOGLE_SECRET="" ;; esac
if [ -n "$GOOGLE_SECRET" ]; then
  G="$(sm "$GOOGLE_SECRET")"
  AUTH_ARGS+=(--from-literal=GOOGLE_CLIENT_ID="$(jkey "$G" GOOGLE_CLIENT_ID)")
  AUTH_ARGS+=(--from-literal=GOOGLE_CLIENT_SECRET="$(jkey "$G" GOOGLE_CLIENT_SECRET)")
fi
mksecret eventide-auth "${AUTH_ARGS[@]}"
echo "google oauth: $([ -n "$GOOGLE_SECRET" ] && echo enabled || echo 'off (needs the eventide/google-oauth secret AND an https:// PUBLIC_URL)')"

S='{}'; [ -n "$STRIPE_SECRET" ] && S="$(sm "$STRIPE_SECRET")"
mksecret eventide-payment \
  --from-literal=STRIPE_SECRET_KEY="$(jkey "$S" STRIPE_SECRET_KEY)" \
  --from-literal=STRIPE_WEBHOOK_SECRET="$(jkey "$S" STRIPE_WEBHOOK_SECRET)"
echo "stripe: $([ -n "$STRIPE_SECRET" ] && echo enabled || echo 'off (no eventide/stripe secret)')"

M='{}'; [ -n "$GMAIL_SECRET" ] && M="$(sm "$GMAIL_SECRET")"
mksecret eventide-mail-worker \
  --from-literal=GMAIL_USER="$(jkey "$M" GMAIL_USER)" \
  --from-literal=GMAIL_APP_PASSWORD="$(jkey "$M" GMAIL_APP_PASSWORD)" \
  --from-literal=MAIL_FROM="$(jkey "$M" MAIL_FROM)"
echo "mail: $([ -n "$GMAIL_SECRET" ] && echo gmail || echo 'dry-run (no eventide/gmail secret)')"

# --- deploy the chart (the db-migrate hook runs before the pods roll) --------
# Through the release gate (scripts/lib.sh): the payment preflight runs first and a blocking or unreadable result stops the release
# before Helm is called; afterwards the rollout, the payment settings and its scheduler are verified, not assumed from helm's exit code.
echo "== release (payment preflight, then helm upgrade --install eventide) =="
release_upgrade values.aws.yaml "$PAYMENT_IMAGE" 420s \
  --set imageRegistry="$REG" \
  --set publicUrl="$PUBLIC_URL" \
  --set files.bucket="$UPLOADS_BUCKET" \
  $(helm_tag_sets "$TAG" $IMAGES) $(keep_sets $IMAGES) \
  || exit 1

for d in $APP_SERVICES redis; do
  kubectl -n eventide rollout status "deployment/$d" --timeout=180s
done

echo
echo "deployed. smoke test:"
for p in auth events regis payment; do echo "  curl $PUBLIC_URL/api/$p/health      # โอเค"; done
echo "  open  $PUBLIC_URL"
echo "  make admin EMAIL=<registered email>   # first admin, after registering in the web"
