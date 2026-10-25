#!/usr/bin/env bash
# Tests scripts/recover-state.sh with stand-ins for `aws`, `terraform` and `pgrep` on PATH: no AWS,
# no real state. TF_DIR points at a temp dir, so the real infra/terraform/errored.tfstate (if there
# is one) is never touched.
#
#   bash scripts/recover-state.test.sh
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
  *"sts get-caller-identity"*) [ "${STUB_NOCREDS:-0}" = 1 ] && exit 255; echo "${STUB_ACCOUNT:-111}" ;;
  *"s3api head-object"*"tflock"*) [ "${STUB_LOCK:-none}" != none ] ;;
  *"s3 cp"*"tflock"*)
    case "$STUB_LOCK" in
      stale) C="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%S.123456789Z)" ;;
      *)     C="$(date -u +%Y-%m-%dT%H:%M:%S.123456789Z)" ;;
    esac
    printf '{"ID":"abc","Operation":"OperationTypeApply","Who":"me@host","Created":"%s"}' "$C" ;;
  *"s3 rm"*) echo "rm-lock" >> "$CALLS" ;;
  *) exit 1 ;;
esac
STUB
cat > "$TMP/bin/terraform" <<'STUB'
#!/usr/bin/env bash
a="$*"
case "$a" in
  *"state pull"*) [ -f "$REMOTE_FILE" ] && cat "$REMOTE_FILE" || exit 1 ;;
  *"state push"*) echo "push" >> "$CALLS"; exit "${PUSH_RC:-0}" ;;
  *) exit 0 ;;
esac
STUB
cat > "$TMP/bin/pgrep" <<'STUB'
#!/usr/bin/env bash
exit "${PGREP_RC:-1}"
STUB
chmod +x "$TMP/bin/"*

export PATH="$TMP/bin:$PATH" TF_DIR="$TMP/tf" CALLS="$TMP/calls" REMOTE_FILE="$TMP/remote.json"
reset() { rm -f "$TMP/tf/"* "$CALLS" "$REMOTE_FILE"; : > "$CALLS"; unset STUB_LOCK STUB_ACCOUNT STUB_NOCREDS PUSH_RC PGREP_RC; }
errored() { printf '{"version":4,"serial":%s,"lineage":"%s","outputs":{"account_id":{"value":"%s"}},"resources":[]}' "$1" "$2" "${3:-111}" > "$TMP/tf/errored.tfstate"; }
remote()  { printf '{"version":4,"serial":%s,"lineage":"%s","resources":[]}' "$1" "$2" > "$REMOTE_FILE"; }
run() { bash "$ROOT/scripts/recover-state.sh" 2>&1; }
calls() { grep -c "^$1$" "$CALLS" 2>/dev/null || true; }

# 1. nothing to recover: silent, no writes
reset; OUT="$(run)"; RC=$?
[ "$RC" = 0 ] && [ -z "$OUT" ] && [ "$(calls push)" = 0 ] && [ "$(calls rm-lock)" = 0 ] && ok "nothing to recover: silent no-op" || bad "no-op: rc=$RC out='$OUT'"

# 2. a stale lock is removed
reset; export STUB_LOCK=stale; OUT="$(run)"; RC=$?
[ "$RC" = 0 ] && [ "$(calls rm-lock)" = 1 ] && echo "$OUT" | grep -q "removed a stale state lock" && ok "stale lock removed" || bad "stale lock: rc=$RC $OUT"

# 3. a fresh lock may be a live run elsewhere: refuse, do not remove
reset; export STUB_LOCK=fresh; OUT="$(run)"; RC=$?
[ "$RC" = 1 ] && [ "$(calls rm-lock)" = 0 ] && ok "a fresh lock is left alone (exit 1)" || bad "fresh lock: rc=$RC removed=$(calls rm-lock)"

# 4. a terraform process here owns the lock: leave it, even when it looks old
reset; export STUB_LOCK=stale PGREP_RC=0; OUT="$(run)"; RC=$?
[ "$RC" = 1 ] && [ "$(calls rm-lock)" = 0 ] && ok "a running terraform keeps its lock" || bad "running terraform: rc=$RC"

# 5. errored.tfstate newer than the remote, same lineage: pushed and kept as *.pushed-*
reset; errored 75 L1; remote 70 L1; OUT="$(run)"; RC=$?
[ "$RC" = 0 ] && [ "$(calls push)" = 1 ] && ls "$TMP/tf" | grep -q '^errored.tfstate.pushed-' && [ ! -f "$TMP/tf/errored.tfstate" ] \
  && ok "newer errored state pushed, original kept as .pushed-*" || bad "push: rc=$RC calls=$(calls push) files=$(ls "$TMP/tf")"

# 6. not newer than the remote: archived, never pushed
reset; errored 70 L1; remote 70 L1; OUT="$(run)"; RC=$?
[ "$RC" = 0 ] && [ "$(calls push)" = 0 ] && ls "$TMP/tf" | grep -q '^errored.tfstate.stale-' && ok "an older errored state is archived, not pushed" || bad "stale: rc=$RC files=$(ls "$TMP/tf")"

# 7. from another account (a lab reset gave a new one): archived, not pushed
reset; errored 75 L1 999; remote 3 L2; OUT="$(run)"; RC=$?
[ "$RC" = 0 ] && [ "$(calls push)" = 0 ] && ls "$TMP/tf" | grep -q '^errored.tfstate.foreign-' && ok "an errored state from another account is archived" || bad "foreign: rc=$RC files=$(ls "$TMP/tf")"

# 8. different lineage on the same account: a human decides (nothing moved, exit 1)
reset; errored 75 L1; remote 70 L2; OUT="$(run)"; RC=$?
[ "$RC" = 1 ] && [ "$(calls push)" = 0 ] && [ -f "$TMP/tf/errored.tfstate" ] && ok "lineage mismatch: stops, file untouched" || bad "lineage: rc=$RC"

# 9. no remote state at all (an interrupted FIRST apply): push it
reset; errored 12 L1; OUT="$(run)"; RC=$?
[ "$RC" = 0 ] && [ "$(calls push)" = 1 ] && echo "$OUT" | grep -q "no remote state yet" && ok "no remote state: errored state pushed" || bad "no remote: rc=$RC"

# 10. the push fails: exit 1 and the file stays for the next try
reset; errored 75 L1; remote 70 L1; export PUSH_RC=1; OUT="$(run)"; RC=$?
[ "$RC" = 1 ] && [ -f "$TMP/tf/errored.tfstate" ] && echo "$OUT" | grep -q "do NOT run terraform apply first" && ok "failed push: exit 1, file kept, warns not to apply" || bad "failed push: rc=$RC"

# 11. no credentials: skipped quietly, nothing touched
reset; errored 75 L1; export STUB_NOCREDS=1; OUT="$(run)"; RC=$?
[ "$RC" = 0 ] && [ "$(calls push)" = 0 ] && [ -f "$TMP/tf/errored.tfstate" ] && ok "no credentials: skipped, file untouched" || bad "no creds: rc=$RC"

[ "$fail" = 0 ] && echo "all passed" || { echo "FAILED"; exit 1; }
