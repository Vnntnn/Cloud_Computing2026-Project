#!/usr/bin/env bash
# Tests scripts/teardown.sh end to end with stand-ins for `aws`, `terraform` and `kubectl` on PATH:
# no AWS, nothing is ever destroyed. The point: `make down` must exit non-zero whenever the apply
# fails OR a list cannot be read OR a resource is still there (it once exited 0 after the lab
# cut the credentials half way through the destroy). TF_DIR is a temp dir, so the real
# infra/terraform/errored.tfstate (if any) is never touched.
#
#   bash scripts/teardown.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/tf"
fail=0
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fail=1; }

cat > "$TMP/bin/aws" <<'STUB'
#!/usr/bin/env bash
a="$*"
case "$a" in
  *"sts get-caller-identity"*) echo 111 ;;
  *"s3api head-bucket"*) exit 0 ;;
  *"s3api head-object"*) exit 1 ;;                       # no lock, no old state to carry over
  *"s3api"*|*"s3 "*) exit 0 ;;
  *"eks list-clusters"*) [ "${STUB_DENIED:-0}" = 1 ] && { echo "AccessDenied: eks:ListClusters" >&2; exit 255; }; echo "${STUB_EKS:-}" ;;
  *) [ "${STUB_DENIED:-0}" = 1 ] && { echo "AccessDenied: not authorized" >&2; exit 255; }; echo "" ;;
esac
STUB
cat > "$TMP/bin/terraform" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *" apply "*) echo "STUB terraform apply" >> "$CALLS"; exit "${STUB_APPLY_RC:-0}" ;;
  *) exit 0 ;;
esac
STUB
cat > "$TMP/bin/kubectl" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
cat > "$TMP/bin/pgrep" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
chmod +x "$TMP/bin/"*
export PATH="$TMP/bin:$PATH" TF_DIR="$TMP/tf" CALLS="$TMP/calls"
run() { : > "$CALLS"; bash "$ROOT/scripts/teardown.sh" 2>&1; }

# 1. apply ok, every list empty: exit 0 and says so
unset STUB_DENIED STUB_EKS STUB_APPLY_RC
OUT="$(run)"; RC=$?
[ "$RC" = 0 ] && echo "$OUT" | grep -q "verified clean" && ok "clean teardown exits 0" || bad "clean: rc=$RC"
[ "$(grep -c 'STUB terraform apply' "$CALLS")" = 1 ] && ok "ran exactly one apply" || bad "apply count: $(cat "$CALLS")"
[ "$(echo "$OUT" | grep -c '  gone ')" = 14 ] && ok "all 14 lists reported gone" || bad "gone lines: $(echo "$OUT" | grep -c '  gone ')"

# 2. the credentials are cut: lists cannot be read -> unverified, exit 1 (this is what used to look clean)
export STUB_DENIED=1
OUT="$(run)"; RC=$?
[ "$RC" = 1 ] && echo "$OUT" | grep -q "UNVERIFIED" && echo "$OUT" | grep -q "NOT CLEAN" && ok "unreadable lists: UNVERIFIED, exit 1" || bad "denied: rc=$RC"
echo "$OUT" | grep -q "  gone " && bad "an unreadable list was reported as gone" || ok "an unreadable list is never reported as gone"
unset STUB_DENIED

# 3. the apply fails but the lists look empty: still exit 1, with the recovery hint
export STUB_APPLY_RC=1
OUT="$(run)"; RC=$?
[ "$RC" = 1 ] && echo "$OUT" | grep -q "terraform apply FAILED" && echo "$OUT" | grep -q "recovered automatically" && ok "a failed apply exits 1 with the recovery hint" || bad "apply failed: rc=$RC"
unset STUB_APPLY_RC

# 4. apply ok but a cluster survived: exit 1 and names it
export STUB_EKS="eventide"
OUT="$(run)"; RC=$?
[ "$RC" = 1 ] && echo "$OUT" | grep -q "STILL THERE  EKS clusters: eventide" && ok "a surviving resource: STILL THERE, exit 1" || bad "survivor: rc=$RC"
unset STUB_EKS

[ "$fail" = 0 ] && echo "all passed" || { echo "FAILED"; exit 1; }
