#!/usr/bin/env bash
# bash scripts/scan-secrets.test.sh — the secret scanner reports where, never what, and treats ignored files as local-only.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP" && git init -q . && git config user.email t@example.com && git config user.name t
# credential-shaped values made at run time, so this file never holds one
rand() { head -c 30 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28; }
KEY="rk_te""st_$(rand)"; HOOK="whs""ec_$(rand)"
printf 'name = "x"\nstripe_secret_key = "%s"\n' "$KEY" > shared.tfvars
printf 'hook = "%s"\n' "$HOOK" > ignored.auto.tfvars
printf 'const k = "sk_test_placeholder"\n' > placeholder.ts
printf '*.auto.tfvars\n' > .gitignore
git add shared.tfvars placeholder.ts .gitignore

out="$(bash "$ROOT/scripts/scan-secrets.sh" 2>&1)"; rc=$?
[ "$rc" = 1 ] || { echo "FAIL: a key in a shared file must fail the scan (rc=$rc)"; exit 1; }
echo "$out" | grep -q '^shared.tfvars:2: stripe-restricted-key$' || { echo "FAIL: it should say where: $out"; exit 1; }
case "$out" in *"$KEY"*|*"$HOOK"*|*"${KEY:8:10}"*) echo "FAIL: the scan printed (part of) a credential"; exit 1 ;; esac
echo "$out" | grep -q 'placeholder' && { echo "FAIL: a short placeholder is not a finding"; exit 1; }
echo "$out" | grep -q 'ignored.auto' && { echo "FAIL: an ignored file is not scanned by default"; exit 1; }

git rm -q --cached shared.tfvars; rm shared.tfvars
out="$(bash "$ROOT/scripts/scan-secrets.sh" --ignored 2>&1)"; rc=$?
[ "$rc" = 0 ] || { echo "FAIL: an ignored file alone must not fail the scan (rc=$rc)"; exit 1; }
echo "$out" | grep -q '^ignored.auto.tfvars:1: stripe-webhook-secret  (ignored file: local only)$' || { echo "FAIL: --ignored should list it: $out"; exit 1; }
case "$out" in *"$HOOK"*|*"${HOOK:8:10}"*) echo "FAIL: --ignored printed (part of) a credential"; exit 1 ;; esac

# and the repository itself: nothing git would share holds one
cd "$ROOT" && bash scripts/scan-secrets.sh >/dev/null || { echo "FAIL: the repository has a credential-shaped string in a shared file"; bash scripts/scan-secrets.sh; exit 1; }
echo "scan-secrets.test.sh: 4 pass"
