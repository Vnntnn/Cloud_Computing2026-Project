#!/usr/bin/env bash
# bash scripts/release.test.sh — the payment release gate (scripts/lib.sh, release.sh) against stub kubectl and helm.
# What this shows: the order and the arguments of the calls, and that a blocking, missing or invalid preflight stops a release (and a
# rollback) before Helm is called. What it can't show: how a real cluster behaves (termination, readiness). Nothing here touches one.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
CALLS="$TMP/calls"; : > "$CALLS"

# --- stubs: every call is logged; what they answer comes from the environment ---------------------------------
cat > "$TMP/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
args="$*"
echo "kubectl $args" >> "$CALLS"
case "$args" in
  *"get deploy payment -o name"*)
    case "${DEPLOY:-exists}" in
      exists) echo deployment.apps/payment ;;
      missing) echo 'Error from server (NotFound): deployments.apps "payment" not found' >&2; exit 1 ;;
      broken) echo 'Unable to connect to the server' >&2; exit 1 ;;
      plugin) echo 'Unable to connect to the server: getting credentials: exec: executable aws not found' >&2; exit 1 ;;
    esac ;;
  *"jsonpath={.spec.template.spec.containers[0].image}"*) echo "reg/eventide/payment:running" ;;
  *"jsonpath={.spec.strategy.type}"*) echo "${STRATEGY:-Recreate}" ;;
  *"jsonpath={.spec.replicas}"*) echo "${REPLICAS:-1}" ;;
  *"jsonpath={.spec.template.spec.terminationGracePeriodSeconds}"*) echo "${GRACE:-210}" ;;
  *"get deploy payment -o json"*)
    [ "${DEPLOY_JSON_FAILS:-0}" = 1 ] && exit 1
    echo '{"spec":{"template":{"spec":{"containers":[{"image":"reg/eventide/payment:running","env":[{"name":"PORT","value":"3000"}]}]}}}}' ;;
  *" run preflight-"*)
    for a in "$@"; do case "$a" in --overrides=*) echo "${a#--overrides=}" >> "$TMP/overrides" ;; esac; done
    n=$(( $(cat "$TMP/pfcount" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$TMP/pfcount"
    if [ "$n" -ge 2 ] && [ -n "${PREFLIGHT_OUTPUT_2+x}" ]; then printf '%s\n' "$PREFLIGHT_OUTPUT_2"; exit "${PREFLIGHT_EXIT_2:-0}"; fi
    printf '%s\n' "${PREFLIGHT_OUTPUT:-}"
    exit "${PREFLIGHT_EXIT:-0}" ;;
  *"rollout status"*) [ "${ROLLOUT_FAILS:-0}" = 1 ] && { echo "error: timed out" >&2; exit 1; }; echo "deployment successfully rolled out" ;;
  *"logs deploy/payment"*) [ "${SCHEDULER_LOGGED:-1}" = 1 ] && echo "Payment reconciler is finishing paid orders left unconfirmed, every minute" ;;
  *" wait "*)
    [ "${WAIT_FAILS:-0}" = 1 ] && { echo "error: timed out waiting for the condition" >&2; exit 1; }
    [ "${WAIT_NO_PODS:-0}" = 1 ] && { echo "error: no matching resources found" >&2; exit 1; }
    exit 0 ;;
  *" scale "*) exit 0 ;;
esac
exit 0
STUB
cat > "$TMP/bin/helm" <<'STUB'
#!/usr/bin/env bash
echo "helm $*" >> "$CALLS"
case "$1" in
  -n|--namespace) # history
    echo '[{"revision":3,"status":"deployed"},{"revision":2,"status":"superseded"},{"revision":1,"status":"superseded"}]' ;;
  upgrade|rollback) [ "${HELM_FAILS:-0}" = 1 ] && { echo "Error: failed" >&2; exit 1; } ; exit 0 ;;
esac
exit 0
STUB
chmod +x "$TMP/bin/kubectl" "$TMP/bin/helm"
export CALLS TMP PATH="$TMP/bin:$PATH" RELEASE_POLL_SECONDS=0

OK_RESULT='PREFLIGHT_RESULT {"ok":true,"mode":"upgrade","blocking":[],"counts":{"intents":0}}'
BLOCKED='PREFLIGHT_RESULT {"ok":false,"mode":"upgrade","blocking":["refund_intents_unresolved"],"counts":{"intents":2}}'

pass=0
run() { # runs a release function in a fresh shell, with the given environment; leaves its output in $OUT and status in $RC
  : > "$CALLS"; : > "$TMP/overrides"; rm -f "$TMP/pfcount"
  OUT="$( (cd "$ROOT"; . scripts/lib.sh; "$@") 2>&1 )"; RC=$?
}
fail() { echo "FAIL: $1"; echo "--- output:"; echo "$OUT"; echo "--- calls:"; cat "$CALLS"; exit 1; }
called() { grep -q -- "$1" "$CALLS"; }
line_of() { grep -n -- "$1" "$CALLS" | head -1 | cut -d: -f1; }
ok() { pass=$((pass + 1)); }

upgrade() { release_upgrade values.aws.yaml reg/eventide/payment:new 420s --set imageRegistry=reg --set services.payment.image.tag=new; }

# 1. a clean upgrade: preflight first, then helm, then the checks of what it left
PREFLIGHT_OUTPUT="$OK_RESULT" run upgrade
[ "$RC" = 0 ] || fail "a clean upgrade should succeed"
[ "$(line_of 'run preflight')" -lt "$(line_of 'helm upgrade')" ] || fail "the preflight must run before helm"; ok
called "helm upgrade --install eventide $ROOT/infra/helm/eventide --namespace eventide -f $ROOT/infra/helm/eventide/values.yaml -f $ROOT/infra/helm/eventide/values.aws.yaml" || fail "wrong release, chart, namespace or overlay"
called -- "--wait --timeout 420s" || fail "helm must wait"; ok
called "rollout status deploy/payment" || fail "the rollout must be checked, not assumed"; ok
grep -q '"image":"reg/eventide/payment:new"' "$TMP/overrides" || fail "an upgrade's preflight must run from the new image"
grep -q '/app/preflight","--mode","upgrade"' "$TMP/overrides" || fail "the preflight must run in upgrade mode"
grep -q '"envFrom":\[{"secretRef":{"name":"eventide-common"}}\]' "$TMP/overrides" || fail "the preflight needs the common Secret"; ok
called "logs deploy/payment" || fail "the scheduler's start must be checked"; ok
[ "$(grep -c 'run preflight' "$CALLS")" = 2 ] || fail "the release must end with a second preflight (the new version reports its status)"; ok

# 2. a blocked upgrade never reaches helm
PREFLIGHT_OUTPUT="$BLOCKED" PREFLIGHT_EXIT=1 run upgrade
[ "$RC" != 0 ] || fail "an upgrade must be blocked by unresolved refund intents"
called "helm" && fail "a blocked upgrade must not call helm at all"; ok
echo "$OUT" | grep -q "refund_intents_unresolved" || fail "the reason should be shown"

# 3. a blocked rollback never scales payment down or calls helm
PREFLIGHT_OUTPUT="$BLOCKED" PREFLIGHT_EXIT=1 run release_rollback 2
[ "$RC" != 0 ] || fail "a rollback must be blocked by unresolved refund intents"
called "helm rollback" && fail "a blocked rollback must not call helm rollback"
called "scale" && fail "a blocked rollback must not touch payment"; ok

# 4. no result, garbage, a result without ok, a result that says ok with a failing pod, an unreadable Deployment: all stop it
for case in "no line:" "garbage:PREFLIGHT_RESULT not-json" "no ok:PREFLIGHT_RESULT {\"blocking\":[]}" "ok not boolean:PREFLIGHT_RESULT {\"ok\":\"yes\",\"blocking\":[]}" "ok but blocking listed:PREFLIGHT_RESULT {\"ok\":true,\"blocking\":[\"x\"]}"; do
  name="${case%%:*}"; out="${case#*:}"
  PREFLIGHT_OUTPUT="$out" run upgrade;  [ "$RC" != 0 ] || fail "upgrade must stop on: $name"; called "helm" && fail "upgrade called helm on: $name"
  PREFLIGHT_OUTPUT="$out" run release_rollback 2; [ "$RC" != 0 ] || fail "rollback must stop on: $name"; called "helm rollback" && fail "rollback called helm on: $name"
done; ok
PREFLIGHT_OUTPUT="$OK_RESULT" PREFLIGHT_EXIT=1 run upgrade
[ "$RC" != 0 ] && ! called "helm" || fail "an ok result from a failed pod must not release"; ok
PREFLIGHT_OUTPUT="$OK_RESULT" DEPLOY_JSON_FAILS=1 run upgrade
[ "$RC" != 0 ] && ! called "helm" || fail "an unreadable payment Deployment must stop the release"; ok

# 5. first install: nothing to protect, so no preflight, and helm runs; an unknown error is not a first install
DEPLOY=missing PREFLIGHT_OUTPUT="$OK_RESULT" run release_upgrade values.aws.yaml reg/eventide/payment:new 420s --set x=y
[ "$RC" = 0 ] || fail "a first install should release"
called "helm upgrade --install" || fail "a first install must go on to helm"
# (the check after the install does run: payment exists by then) but none ran before helm
[ "$(line_of 'helm upgrade')" -lt "$(line_of 'run preflight')" ] || fail "a first install has no payment to check before helm"; ok
DEPLOY=broken run upgrade
[ "$RC" != 0 ] && ! called "helm" || fail "when it cannot tell whether payment exists, it must fail closed"; ok

# 6. the checks after helm are real: failing any of them fails the release
for var in ROLLOUT_FAILS=1 STRATEGY=RollingUpdate GRACE=30 REPLICAS=2 SCHEDULER_LOGGED=0 HELM_FAILS=1; do
  env "$var" CALLS="$CALLS" TMP="$TMP" PREFLIGHT_OUTPUT="$OK_RESULT" bash -c '
    cd "'"$ROOT"'"; . scripts/lib.sh; : > "$CALLS"
    release_upgrade values.aws.yaml reg/eventide/payment:new 420s --set a=b' >/dev/null 2>&1 && fail "upgrade must fail when $var"
done; ok

# 7. a rollback: preflight (from the running image, in rollback mode), payment gone, helm rollback, payment back, verified
PREFLIGHT_OUTPUT='PREFLIGHT_RESULT {"ok":true,"mode":"rollback","blocking":[],"counts":{}}' run release_rollback 2
[ "$RC" = 0 ] || fail "a clean rollback should succeed"
a="$(line_of 'run preflight')"; b="$(line_of 'scale deploy/payment --replicas=0')"; c="$(line_of 'wait --for=delete')"; d="$(line_of 'helm rollback eventide 2')"; e="$(line_of 'scale deploy/payment --replicas=1')"; f="$(line_of 'rollout status')"
[ "$a" -lt "$b" ] && [ "$b" -lt "$c" ] && [ "$c" -lt "$d" ] && [ "$d" -lt "$e" ] && [ "$e" -lt "$f" ] || fail "rollback order must be: preflight, payment down, gone, helm rollback, payment up, rollout check"; ok
called "helm rollback eventide 2 --namespace eventide --wait --timeout 420s" || fail "wrong rollback arguments"; ok
grep -q '"image":"reg/eventide/payment:running"' "$TMP/overrides" || fail "a rollback's preflight must run from the version running now"
grep -q '/app/preflight","--mode","rollback"' "$TMP/overrides" || fail "the preflight must run in rollback mode"; ok

# 8. a rollback to nothing, to a revision that doesn't exist, or whose payment won't go away
for rev in "" abc 9; do
  PREFLIGHT_OUTPUT="$OK_RESULT" run release_rollback "$rev"; [ "$RC" != 0 ] || fail "rollback must refuse revision '$rev'"
  called "helm rollback" && fail "rollback called helm for revision '$rev'"; called "run preflight" && fail "rollback ran before the revision was checked"
done; ok
WAIT_FAILS=1 PREFLIGHT_OUTPUT="$OK_RESULT" run release_rollback 2
[ "$RC" != 0 ] && ! called "helm rollback" || fail "if payment is not gone, helm rollback must not run"
echo "$OUT" | grep -q "scale deploy/payment --replicas=1" || fail "it should say how to restore payment"; ok
# (pods already gone when the wait starts is the wanted outcome, not a failure)
WAIT_NO_PODS=1 PREFLIGHT_OUTPUT="$OK_RESULT" run release_rollback 2
[ "$RC" = 0 ] && called "helm rollback eventide 2" || fail "an already-gone payment pod must not stop a rollback"; ok

# 8b. refund intents or mail that appear while payment drains: the second preflight stops the rollback and payment is put back
PREFLIGHT_OUTPUT='PREFLIGHT_RESULT {"ok":true,"mode":"rollback","blocking":[],"counts":{}}' PREFLIGHT_OUTPUT_2="$BLOCKED" PREFLIGHT_EXIT_2=1 run release_rollback 2
[ "$RC" != 0 ] || fail "a rollback must stop when the state changed while payment drained"
called "helm rollback" && fail "helm rollback must not run after a blocking second preflight"
[ "$(grep -c 'run preflight' "$CALLS")" = 2 ] || fail "a rollback preflights twice: before and after payment drains"
grep -q 'scale deploy/payment --replicas=1' "$CALLS" || fail "payment must be put back when the rollback stops"; ok

# 8c. after an upgrade the new version only has to be able to report: refund intents made meanwhile by live traffic don't fail the release
PREFLIGHT_OUTPUT="$OK_RESULT" PREFLIGHT_OUTPUT_2="$BLOCKED" PREFLIGHT_EXIT_2=1 run upgrade
[ "$RC" = 0 ] || fail "a blocked report after the release is not a failed release"
PREFLIGHT_OUTPUT="$OK_RESULT" PREFLIGHT_OUTPUT_2="PREFLIGHT_RESULT not-json" PREFLIGHT_EXIT_2=1 run upgrade
[ "$RC" != 0 ] || fail "an unreadable report after the release must fail it"; ok

# 8d. only the API server's own NotFound means "first install"; any other error (a missing exec plugin says "not found" too) fails closed
DEPLOY=plugin PREFLIGHT_OUTPUT="$OK_RESULT" run upgrade
[ "$RC" != 0 ] && ! called "helm" || fail "an exec-plugin 'not found' error is not a first install"; ok

# 8e. the one-off pod must keep stdin open (the override replaces the container list, and -i needs it)
PREFLIGHT_OUTPUT="$OK_RESULT" run upgrade
grep -q '"stdin":true' "$TMP/overrides" || fail "the preflight container needs stdin: true"; ok

# 9. the repository's entry points use the gate and nothing else mutates the release
grep -q 'release_upgrade values.aws.yaml' "$ROOT/scripts/deploy.sh" || fail "deploy.sh must release through release_upgrade"
grep -q 'release_upgrade values.local.yaml' "$ROOT/scripts/k3d-up.sh" || fail "k3d-up.sh must release through release_upgrade"
if grep -nE '^\s*helm (upgrade|rollback) +(--install )?eventide' "$ROOT/scripts/deploy.sh" "$ROOT/scripts/k3d-up.sh" "$ROOT/scripts/release.sh" "$ROOT/Makefile"; then fail "a script calls helm upgrade/rollback on the release directly"; fi
grep -q 'scripts/release.sh rollback' "$ROOT/Makefile" || fail "make rollback must go through release.sh"; ok

echo "release.test.sh: $pass pass (stub kubectl and helm; no cluster was touched)"
