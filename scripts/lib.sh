#!/usr/bin/env bash
# Shared by scripts/deploy.sh and scripts/k3d-up.sh. Tested by scripts/lib.test.sh.

# Dockerfile path for an image name.
dockerfile_for() { case "$1" in db-bootstrap) echo packages/db/Dockerfile ;; *) echo "apps/$1/Dockerfile" ;; esac; }

# helm --set arguments pinning image tags: one per service image in the list,
# plus the migrate Job's when db-bootstrap is in it. Driven by the SAME list the
# build loop uses, so a partial build (IMAGES="event web") never points a
# Deployment at a tag that was not pushed.
#   helm_tag_sets <tag> <image>...
helm_tag_sets() {
  local tag="$1"; shift
  local out=() img
  for img in "$@"; do
    case "$img" in
      db-bootstrap) out+=("--set" "dbMigrate.image.tag=$tag") ;;
      *) out+=("--set" "services.$img.image.tag=$tag") ;;
    esac
  done
  echo "${out[*]}"
}

# The chart's deployments that deploy.sh / k3d-up.sh build images for (redis is a public image).
APP_SERVICES="auth event registration payment mail-worker web"

# For a SUBSET build: pin every service NOT in the list to the tag it runs right
# now (a plain --set would reset it to the chart default `latest`, which is never
# pushed), and skip the migrate hook when no migrate image was built.
#   keep_sets <image>...
keep_sets() {
  local out=() s cur
  for s in $APP_SERVICES; do
    case " $* " in *" $s "*) continue ;; esac
    cur="$(kubectl -n eventide get deploy "$s" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | sed 's/.*://')"
    [ -n "$cur" ] && out+=("--set" "services.$s.image.tag=$cur")
  done
  case " $* " in *" db-bootstrap "*) ;; *) out+=("--set" "dbMigrate.enabled=false") ;; esac
  echo "${out[*]}"
}

# --- AWS entry points ---------------------------------------------------------
# infra/aws.env holds the Learner Lab session credentials (see infra/aws.env.example).
load_aws_env() {
  local f="${ROOT:-.}/infra/aws.env"
  if [ -f "$f" ]; then set -a; . "$f"; set +a; fi
  : "${AWS_DEFAULT_REGION:=us-east-1}"; export AWS_DEFAULT_REGION
}
tf() { terraform -chdir="${ROOT:-.}/infra/terraform" "$@"; }
tfout() { tf output -raw "$1" 2>/dev/null; }

# --- the payment release gate --------------------------------------------------
# Every Helm mutation of the app goes through these (deploy.sh, k3d-up.sh and release.sh): the payment service refunds and settles
# money under rules a release can change, and an older version doesn't know the refund intents a newer one leaves behind. So
# before the release the read-only preflight (apps/payment/scripts/preflight.ts, compiled into the payment image as /app/preflight)
# runs inside the cluster, and anything but a clean `PREFLIGHT_RESULT {"ok":true,...}` stops the release before Helm is called.
# Enforced for what goes through these functions. A direct `helm upgrade|rollback` or `kubectl` can still bypass them; docs/tickets.md
# §10 says so, and has the emergency procedure (there is deliberately no flag that skips the check).
RELEASE_NS="${RELEASE_NS:-eventide}"
RELEASE_NAME="${RELEASE_NAME:-eventide}"
RELEASE_CHART="${RELEASE_CHART:-${ROOT:-.}/infra/helm/eventide}"
RELEASE_PAYMENT_GRACE=210   # keep equal to services.payment.terminationGracePeriodSeconds in values.yaml

# Whether the payment Deployment exists: 0 yes, 1 no (a first install has nothing to protect), 2 can't tell (fail closed).
payment_deployed() {
  local out
  if out="$(kubectl -n "$RELEASE_NS" get deploy payment -o name 2>&1)"; then return 0; fi
  # (the API server's own "(NotFound)": other errors can say "not found" too, e.g. a missing exec-plugin binary)
  case "$out" in *"(NotFound)"*) return 1 ;; *) return 2 ;; esac
}

# payment_preflight <upgrade|rollback> <image> [report]: runs the image's /app/preflight as a one-off pod with the payment Deployment's env
# and the common Secret (DATABASE_URL). 0 only when the last PREFLIGHT_RESULT line is valid JSON with ok=true and the pod succeeded;
# with `report` any valid result is 0 (used after a release, which only needs the new version to be able to report: refund intents
# that live traffic made in the meantime are not a failed release).
# Prints the check's own lines (counts, never a connection string or a message) and nothing else of what it got.
payment_preflight() {
  local mode="$1" image="$2" report="${3:-}" deploy env out status line
  deploy="$(kubectl -n "$RELEASE_NS" get deploy payment -o json 2>/dev/null)" || { echo "release stopped: cannot read the payment Deployment"; return 1; }
  env="$(printf '%s' "$deploy" | jq -c '.spec.template.spec.containers[0].env // []')" || { echo "release stopped: cannot read the payment env"; return 1; }
  set +e
  out="$(kubectl -n "$RELEASE_NS" run "preflight-$(date +%s)" --rm -i --restart=Never --image="$image" \
    --overrides="$(jq -cn --arg img "$image" --arg mode "$mode" --argjson env "$env" --arg secret "${RELEASE_COMMON_SECRET:-eventide-common}" \
      '{spec:{containers:[{name:"preflight",image:$img,stdin:true,stdinOnce:true,command:["/app/preflight","--mode",$mode],env:$env,envFrom:[{secretRef:{name:$secret}}]}]}}')" 2>&1)"
  status=$?
  set -e
  # only the check's own lines (counts); whatever else the pod or kubectl said stays unprinted
  printf '%s\n' "$out" | grep -E '^(mode|schema has|refund intents|payments held|refunds held|paid payments|notifications pending|ticket mails|rows violating|payments_paid_at_check|migrations applied|preflight could not) ' | head -20 || true
  line="$(printf '%s\n' "$out" | grep '^PREFLIGHT_RESULT ' | tail -1 || true)"
  if [ -z "$line" ]; then
    echo "release stopped: the preflight gave no result (pod exit $status); not releasing"
    echo "  (an image built before /app/preflight existed can't run it: a first release with this gate must build the payment image, IMAGES including payment)"
    return 1
  fi
  if ! printf '%s' "${line#PREFLIGHT_RESULT }" | jq -e 'type == "object" and (.ok | type == "boolean") and (.blocking | type == "array")' >/dev/null 2>&1; then
    echo "release stopped: the preflight result is not valid; not releasing"; return 1
  fi
  if [ -n "$report" ]; then echo "preflight ($mode): reported"; return 0; fi
  if printf '%s' "${line#PREFLIGHT_RESULT }" | jq -e '.ok == true and (.blocking | length == 0)' >/dev/null 2>&1; then
    [ "$status" -eq 0 ] || { echo "release stopped: the preflight said ok but its pod failed (exit $status)"; return 1; }
    echo "preflight ($mode): ok"; return 0
  fi
  echo "release stopped: the preflight blocks the $mode: $(printf '%s' "${line#PREFLIGHT_RESULT }" | jq -r '.blocking | join(", ")')"
  echo "  resolve it first (docs/tickets.md §10): unresolved refund intents finish by themselves while a payment pod runs; mail owed is sent by the scheduler"
  return 1
}

# payment_gate <upgrade|rollback> <image>: the preflight, unless there is no payment Deployment yet (a first install).
payment_gate() {
  local rc=0
  payment_deployed || rc=$?
  case "$rc" in
    0) payment_preflight "$1" "$2" ;;
    1) echo "no payment Deployment yet (first install): nothing to protect"; return 0 ;;
    *) echo "release stopped: cannot tell whether the payment Deployment exists"; return 1 ;;
  esac
}

# The image the payment Deployment runs now.
payment_running_image() { kubectl -n "$RELEASE_NS" get deploy payment -o jsonpath='{.spec.template.spec.containers[0].image}'; }

# What a release must have left behind: payment rolled out, one pod, Recreate, the grace period, and (an upgrade) a scheduler that
# started and a preflight that can read the database from the new image.
#   payment_verify <upgrade|rollback>
payment_verify() {
  local mode="$1" strategy replicas grace tries=0
  kubectl -n "$RELEASE_NS" rollout status deploy/payment --timeout=240s || { echo "release FAILED: payment did not roll out"; return 1; }
  strategy="$(kubectl -n "$RELEASE_NS" get deploy payment -o jsonpath='{.spec.strategy.type}')"
  replicas="$(kubectl -n "$RELEASE_NS" get deploy payment -o jsonpath='{.spec.replicas}')"
  grace="$(kubectl -n "$RELEASE_NS" get deploy payment -o jsonpath='{.spec.template.spec.terminationGracePeriodSeconds}')"
  [ "$replicas" = "1" ] || { echo "release FAILED: payment runs $replicas pod(s), expected 1"; return 1; }
  if [ "$mode" = upgrade ]; then
    [ "$strategy" = "Recreate" ] || { echo "release FAILED: payment strategy is '$strategy', expected Recreate"; return 1; }
    [ "$grace" = "$RELEASE_PAYMENT_GRACE" ] || { echo "release FAILED: payment grace period is '$grace', expected $RELEASE_PAYMENT_GRACE"; return 1; }
    # the scheduler says so in its log once it runs (production only: the chart's NODE_ENV)
    until kubectl -n "$RELEASE_NS" logs deploy/payment --tail=200 2>/dev/null | grep -q "Payment reconciler is finishing paid orders"; do
      tries=$((tries + 1)); [ "$tries" -le 12 ] || { echo "release FAILED: the payment scheduler never reported that it started"; return 1; }
      sleep "${RELEASE_POLL_SECONDS:-5}"
    done
    payment_preflight upgrade "$(payment_running_image)" report >/dev/null \
      || { echo "release FAILED: the new payment version cannot report its recovery status (preflight)"; return 1; }
  fi
  echo "payment verified ($mode): rolled out, 1 pod, strategy $strategy, grace ${grace}s"
}

# release_upgrade <overlay values file> <payment image the release will run> <helm timeout> <extra helm args...>
release_upgrade() {
  local overlay="$1" image="$2" timeout="$3"; shift 3
  payment_gate upgrade "$image" || return 1
  helm upgrade --install "$RELEASE_NAME" "$RELEASE_CHART" --namespace "$RELEASE_NS" \
    -f "$RELEASE_CHART/values.yaml" -f "$RELEASE_CHART/$overlay" "$@" --wait --timeout "$timeout" \
    || { echo "release FAILED: helm did not finish — helm -n $RELEASE_NS status $RELEASE_NAME; kubectl -n $RELEASE_NS get pods; kubectl -n $RELEASE_NS logs job/db-migrate"; return 1; }
  payment_verify upgrade
}

# release_rollback <revision>: back to a Helm revision. An older chart may not be Recreate, and an older payment version must never
# run next to the newer one, so payment is scaled to zero and gone before Helm is called, and scaled back after.
release_rollback() {
  local revision="$1" image
  case "$revision" in ''|*[!0-9]*) echo "release stopped: a rollback needs a numeric Helm revision (helm -n $RELEASE_NS history $RELEASE_NAME)"; return 1 ;; esac
  helm -n "$RELEASE_NS" history "$RELEASE_NAME" -o json | jq -e --argjson r "$revision" 'map(select(.revision == $r)) | length == 1' >/dev/null \
    || { echo "release stopped: $RELEASE_NAME has no revision $revision"; return 1; }
  payment_deployed || { echo "release stopped: no payment Deployment to roll back (or cannot tell)"; return 1; }
  image="$(payment_running_image)"
  # the preflight runs from the version that is running now (the newer one, which knows what the older must not meet)
  payment_preflight rollback "$image" || return 1
  kubectl -n "$RELEASE_NS" scale deploy/payment --replicas=0 || { echo "release stopped: could not scale payment down"; return 1; }
  # (kubectl wait fails with "no matching resources" when the pods are already gone, which is what is wanted)
  local gone gone_rc=0
  gone="$(kubectl -n "$RELEASE_NS" wait --for=delete pod -l app.kubernetes.io/name=payment --timeout=$((RELEASE_PAYMENT_GRACE + 60))s 2>&1)" || gone_rc=$?
  if [ "$gone_rc" -ne 0 ]; then
    case "$gone" in *"no matching resources"*) ;; *)
      echo "release FAILED: payment pods did not go away; payment is scaled to 0 — restore with: kubectl -n $RELEASE_NS scale deploy/payment --replicas=1"; return 1 ;;
    esac
  fi
  # the pod that was draining may have recorded refund intents or mail after the first check: look again, with nobody writing
  if ! payment_preflight rollback "$image"; then
    echo "release stopped: the state changed while payment drained; putting payment back"
    kubectl -n "$RELEASE_NS" scale deploy/payment --replicas=1 || echo "  could not scale payment back up: kubectl -n $RELEASE_NS scale deploy/payment --replicas=1"
    return 1
  fi
  helm rollback "$RELEASE_NAME" "$revision" --namespace "$RELEASE_NS" --wait --timeout 420s \
    || { echo "release FAILED: helm rollback did not finish; payment is scaled to 0 — see helm -n $RELEASE_NS status $RELEASE_NAME, then scale it back"; return 1; }
  kubectl -n "$RELEASE_NS" scale deploy/payment --replicas=1 || { echo "release FAILED: could not scale payment back up"; return 1; }
  payment_verify rollback
}
