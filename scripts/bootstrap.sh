#!/usr/bin/env bash
# `make deploy`: from an empty AWS account (a fresh or just-reset Learner Lab) to the system
# serving traffic, in one command; on a running platform it is just a redeploy. The only things
# it cannot do for you are pasting the session credentials into infra/aws.env and, once per
# reset, the Cloudflare delegation when CLOUDFLARE_API_TOKEN is not set (it tells you what to
# paste and waits). Everything else is idempotent.
#
#   make deploy                          (needs a fresh infra/aws.env)
#   NODE_INSTANCE_TYPE=t3.medium make deploy     bigger nodes for the HPA load test
#   IMAGES="event web" make deploy       only rebuild those (ignored when the cluster is new)
#
# What it does, in order:
#   0 preflight        tools, Docker, credentials
#   1 state            state bucket + terraform init (a reset removes the old state)
#   2 secrets          .env -> *.auto.tfvars, only when those files are missing
#   3 permanent layer  VPC, ECR, S3, SQS, secrets, Route 53 zone, ACM request   (skipped when the platform is up)
#   4 DNS + cert       Cloudflare delegation, wait for the certificate to issue   (skipped when the platform is up)
#   5 image mirrors    ingress-nginx and metrics-server into ECR (the edge tier cannot pull public images)
#   6 platform         terraform apply: EKS, NAT, endpoints, RDS + Proxy, ElastiCache, ALB + WAF, alarms
#   7 application      scripts/deploy.sh: build + push, k8s Secrets, helm upgrade (migrates first)
#   8 smoke test       the public health endpoints
#   9 demo data        accounts, categories and events for the presentation (scripts/seed-demo.sh; SEED_DEMO=0 skips)
# Cost: while the platform is up it bills about $0.5/h; `make down` at the end of the session.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib.sh"
load_aws_env

PROJECT=eventide
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
step() { printf '\n==== %s ====\n' "$*"; }
die() { echo "deploy: $*" >&2; exit 1; }

step "0. preflight"
for t in aws terraform docker kubectl helm jq curl python3; do
  command -v "$t" >/dev/null || die "'$t' is not installed"
done
docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable (images are built locally)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "no valid AWS credentials. Start Lab, then paste the three values from AWS Details into infra/aws.env"
echo "account $ACCOUNT, region $REGION"

step "1. Terraform state"
bash "$ROOT/scripts/tf-init.sh"

step "2. third-party secrets"
T="$ROOT/infra/terraform"
# sync-secrets removes the tfvars of any group that .env leaves empty, and Terraform then deletes that
# secret: so only run it on a fresh clone, where none of the three files exist yet
if [ -f "$ROOT/.env" ] && ! { [ -f "$T/google.auto.tfvars" ] || [ -f "$T/gmail.auto.tfvars" ] || [ -f "$T/stripe.auto.tfvars" ]; }; then
  bash "$ROOT/scripts/sync-secrets.sh"       # build the tfvars from .env
else
  echo "(keeping the existing infra/terraform/*.auto.tfvars; run \`make secrets\` to change them)"
fi

# The platform counts as live when the cluster exists in the account. Terraform's state alone
# is not trusted: after a lab reset it still lists resources the account no longer has.
if aws eks describe-cluster --name "$PROJECT" >/dev/null 2>&1; then LIVE=1; else LIVE=0; fi

if [ "$LIVE" = 0 ]; then
  step "3. permanent layer (VPC, ECR, S3, SQS, secrets, Route 53 zone, ACM request)"
  EXTRA=()
  UPLOADS="$PROJECT-uploads-$ACCOUNT"
  # the bucket is created by a local-exec that never re-runs: a stale state would think it exists
  if tf state list 2>/dev/null | grep -qx 'terraform_data.uploads_bucket' \
     && ! aws s3api head-bucket --bucket "$UPLOADS" 2>/dev/null; then
    echo "the state remembers the uploads bucket but the account has none (lab reset): recreating it"
    EXTRA+=(-replace=terraform_data.uploads_bucket)
  fi
  # platform=false is safe here: the cluster is not in the account, so there is nothing to destroy
  tf apply -auto-approve -input=false -var platform=false "${EXTRA[@]}"

  step "4. DNS delegation and certificate"
  if [ -n "$(tfout public_host || true)" ]; then
    bash "$ROOT/scripts/delegate-dns.sh" || die "the delegation is not in place yet; fix it (see above) and run \`make deploy\` again"
    CERT="$(tfout acm_certificate_arn)"
    echo "waiting for the certificate to issue (a few minutes once the delegation is live)..."
    for i in $(seq 1 80); do
      S="$(aws acm describe-certificate --certificate-arn "$CERT" --query Certificate.Status --output text)"
      [ "$S" = ISSUED ] && break
      [ "$S" = FAILED ] && die "ACM validation failed; check the Route 53 records for the certificate"
      [ $((i % 4)) = 0 ] && echo "  certificate: $S (${i}x30s)"
      sleep 30
    done
    [ "$S" = ISSUED ] || die "the certificate is still $S after 40 min: is the Cloudflare delegation right? run \`make deploy\` again once it is"
    echo "certificate ISSUED"
  else
    echo "(no custom domain configured: the site will be on the load balancer's own name over http)"
  fi
else
  echo; echo "(the platform is already up: skipping the permanent layer, DNS and certificate steps)"
fi

step "5. image mirrors in ECR"
if ! aws ecr describe-images --repository-name k8s/ingress-nginx-controller --image-ids imageTag=v1.15.1 >/dev/null 2>&1 \
   || ! aws ecr describe-images --repository-name k8s/metrics-server --image-ids imageTag=v0.7.2 >/dev/null 2>&1; then
  bash "$ROOT/scripts/mirror-images.sh"
else
  echo "(ingress-nginx and metrics-server are already mirrored)"
fi

step "6. platform (EKS, NAT, endpoints, RDS + Proxy, ElastiCache, ALB + WAF, alarms)"
if [ "$LIVE" = 1 ]; then
  # a state that lost the Helm releases would make the apply fail on "cannot re-use a name"
  aws eks update-kubeconfig --region "$REGION" --name "$PROJECT" >/dev/null
  adopt_helm_releases
fi
tf apply -auto-approve -input=false ${NODE_INSTANCE_TYPE:+-var node_instance_type=$NODE_INSTANCE_TYPE}
aws eks update-kubeconfig --region "$REGION" --name "$PROJECT" >/dev/null
kubectl wait --for=condition=Ready node --all --timeout=300s >/dev/null && echo "nodes ready: $(kubectl get nodes --no-headers | wc -l)"

step "7. application"
if ! kubectl -n eventide get deploy auth >/dev/null 2>&1 && [ -n "${IMAGES:-}" ]; then
  echo "new cluster: building every image (ignoring IMAGES=\"$IMAGES\")"; unset IMAGES
fi
bash "$ROOT/scripts/deploy.sh"

step "8. smoke test"
URL="$(tfout public_url || true)"; [ -n "$URL" ] || URL="http://$(tfout alb_dns_name)"
bad=1
for attempt in $(seq 1 20); do   # the load balancer needs a minute to see the targets
  bad=0
  for p in auth events regis payment; do
    c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL/api/$p/health" || true)"
    [ "$c" = 200 ] || { bad=1; break; }
  done
  [ "$bad" = 0 ] && break
  sleep 15
done
[ "$bad" = 0 ] && echo "health: auth events regis payment all answer 200 at $URL" \
  || echo "WARNING: not every health endpoint answers 200 yet at $URL (give the load balancer a few more minutes, then check: kubectl -n eventide get pods)"

step "9. prepared demo data"
# a new database is empty: seed the demo (idempotent: it does nothing when the demo accounts exist). It is not part
# of what makes the system work, so a failure here warns and does not fail the deploy.
if [ "${SEED_DEMO:-1}" = 0 ]; then
  echo "(skipped: SEED_DEMO=0)"
else
  BASE_URL="$URL" bash "$ROOT/scripts/seed-demo.sh" || echo "WARNING: the demo data was not seeded (see above). The system itself is up; retry with: make demo"
fi

cat <<EOF

done. $URL
  demo accounts: demo/.credentials (admin, organizer, attendee; or SEED_DEMO=0 and register one yourself, then make admin EMAIL=…)
  end of session:  make down   (the platform bills about \$0.5/h until then)
EOF
