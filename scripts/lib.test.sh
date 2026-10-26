#!/usr/bin/env bash
# bash scripts/lib.test.sh — the helm --set list must follow IMAGES, not a fixed list.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

got="$(helm_tag_sets abc event web db-bootstrap)"
want="--set services.event.image.tag=abc --set services.web.image.tag=abc --set dbMigrate.image.tag=abc"
[ "$got" = "$want" ] || { echo "FAIL (subset): got '$got'"; exit 1; }

got="$(helm_tag_sets v1 auth)"
want="--set services.auth.image.tag=v1"
[ "$got" = "$want" ] || { echo "FAIL (no db-bootstrap => no dbMigrate tag): got '$got'"; exit 1; }

echo "lib.test.sh: 2 pass"

# keep_sets: services NOT rebuilt keep their live tag; no db-bootstrap => migrate hook off.
kubectl() { echo "reg/eventide/$5:oldtag"; }   # stub: `kubectl -n eventide get deploy <name> ...`
got="$(keep_sets event)"
want="--set services.auth.image.tag=oldtag --set services.registration.image.tag=oldtag --set services.payment.image.tag=oldtag --set services.mail-worker.image.tag=oldtag --set services.web.image.tag=oldtag --set dbMigrate.enabled=false"
[ "$got" = "$want" ] || { echo "FAIL (keep_sets subset): got '$got'"; exit 1; }
got="$(keep_sets auth event registration payment mail-worker web db-bootstrap)"
[ -z "$got" ] || { echo "FAIL (keep_sets full set must be empty): got '$got'"; exit 1; }
echo "lib.test.sh: 4 pass"

# The payment chart must never roll two versions side by side (refunds and settlement follow rules a release can change): one
# Deployment, Recreate (no rollingUpdate block, so no maxSurge), a grace period long enough for the longest chain of Stripe calls one record can make (210 s),
# one pod, no autoscaler, and no other workload running the payment image. The check is a function so it can be shown to fail.
# Rendering is not the cluster's behaviour; it only keeps the chart from losing the setting.
payment_chart_problems() { # reads `helm template` output on stdin, prints one line per problem
  python3 -c '
import re, sys
docs = sys.stdin.read().split("\n---\n")
problems = []
pay = [d for d in docs if "\nkind: Deployment\n" in "\n" + d + "\n" and re.search(r"^  name: payment$", d, re.M)]
if len(pay) != 1:
    problems.append(f"expected one payment Deployment, found {len(pay)}")
else:
    d = pay[0]
    if not re.search(r"^  strategy:\n    type: Recreate$", d, re.M): problems.append("payment must roll with strategy Recreate")
    if "rollingUpdate" in d or "maxSurge" in d: problems.append("payment must not set rollingUpdate/maxSurge")
    if not re.search(r"^      terminationGracePeriodSeconds: 210$", d, re.M): problems.append("payment needs terminationGracePeriodSeconds: 210")
    if not re.search(r"^  replicas: 1$", d, re.M): problems.append("payment runs one pod")
for d in docs:
    if "kind: HorizontalPodAutoscaler" in d and re.search(r"^  name: payment$", d, re.M): problems.append("payment must not have an autoscaler")
    if re.search(r"^kind: (Deployment|StatefulSet|DaemonSet|Job|CronJob)$", d, re.M) and not re.search(r"^  name: payment$", d, re.M) and re.search(r"image: \S*eventide/payment:", d):
        problems.append("only the payment Deployment may run the payment image")
print("\n".join(problems))
'
}
if command -v helm >/dev/null; then
  chart="$(dirname "$0")/../infra/helm/eventide"
  render() { helm template t "$chart" -f "$chart/$1" --set files.bucket=b "${@:2}"; }
  for values in values.local.yaml values.aws.yaml; do
    problems="$(render "$values" | payment_chart_problems)"
    [ -z "$problems" ] || { echo "FAIL ($values): $problems"; exit 1; }
  done
  echo "lib.test.sh: 5 pass (payment chart)"
  # and the check must notice each way of getting it wrong
  must_fail() { # name, then the --set arguments that break the chart
    local name="$1"; shift
    [ -n "$(render values.local.yaml "$@" | payment_chart_problems)" ] || { echo "FAIL: the chart check missed: $name"; exit 1; }
  }
  must_fail "a rolling update" --set services.payment.strategy.type=RollingUpdate
  must_fail "no strategy at all" --set services.payment.strategy=null
  must_fail "a short grace period" --set services.payment.terminationGracePeriodSeconds=30
  must_fail "two pods" --set services.payment.replicas=2
  must_fail "an autoscaler" --set services.payment.hpa.enabled=true --set services.payment.hpa.minReplicas=1 --set services.payment.hpa.maxReplicas=2 --set services.payment.hpa.targetCPUUtilizationPercentage=60
  echo "lib.test.sh: 10 pass (payment chart check fails when it should)"
else
  echo "lib.test.sh: payment chart check skipped (no helm)"
fi

# adopt_helm_releases: imports a release only when the cluster has it AND the state does not; never twice, never a missing one.
IMPORTS=""
tf() { case "$1" in state) printf '%s\n' "${STATE:-}" ;; import) IMPORTS="$IMPORTS|$3=$4" ;; esac; }
helm() { case " ${HAVE:-} " in *" $4 "*) return 0 ;; *) return 1 ;; esac; }   # stub: `helm status -n <ns> <name>`
STATE=$'terraform_data.x\nhelm_release.metrics_server[0]'; HAVE="ingress-nginx metrics-server"; IMPORTS=""
adopt_helm_releases >/dev/null
[ "$IMPORTS" = "|helm_release.ingress_nginx[0]=ingress-nginx/ingress-nginx" ] || { echo "FAIL (adopt only what the state lacks): got '$IMPORTS'"; exit 1; }
STATE=""; HAVE="metrics-server"; IMPORTS=""
adopt_helm_releases >/dev/null
[ "$IMPORTS" = "|helm_release.metrics_server[0]=kube-system/metrics-server" ] || { echo "FAIL (adopt only what the cluster has): got '$IMPORTS'"; exit 1; }
STATE=$'helm_release.ingress_nginx[0]\nhelm_release.metrics_server[0]'; HAVE="ingress-nginx metrics-server"; IMPORTS=""
adopt_helm_releases >/dev/null
[ -z "$IMPORTS" ] || { echo "FAIL (nothing to adopt when the state has both): got '$IMPORTS'"; exit 1; }
STATE=""; HAVE=""; IMPORTS=""
adopt_helm_releases >/dev/null
[ -z "$IMPORTS" ] || { echo "FAIL (nothing to adopt on an empty cluster): got '$IMPORTS'"; exit 1; }
echo "lib.test.sh: adopt_helm_releases 4 pass"
