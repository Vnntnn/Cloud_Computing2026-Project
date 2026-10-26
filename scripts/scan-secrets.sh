#!/usr/bin/env bash
# Looks for credential-shaped strings in the files git would share (tracked, and untracked but not ignored) and prints WHERE, never WHAT:
# `path:line: kind`. With --ignored it also lists the ignored files (.env, *.auto.tfvars, ...): those are meant to hold secrets, so
# they are only reported, never a failure. Exit 1 when something is found in a file git would share.
#   bash scripts/scan-secrets.sh [--ignored]
# Output is safe to paste: a match is reduced to its line number before it leaves grep. A short placeholder (sk_test_placeholder) is not a finding.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
declare -A KINDS=(
  [stripe-secret-key]='sk_(test|live)_[A-Za-z0-9]{12,}'
  [stripe-restricted-key]='rk_(test|live)_[A-Za-z0-9]{12,}'
  [stripe-webhook-secret]='whsec_[A-Za-z0-9]{12,}'
  [aws-access-key-id]='(AKIA|ASIA)[0-9A-Z]{16}'
  [private-key]='-----BEGIN [A-Z ]*PRIVATE KEY-----'
)
scan() { # file -> prints path:line: kind for each hit; returns 0 if any
  local f="$1" kind n found=1
  for kind in "${!KINDS[@]}"; do
    while IFS= read -r n; do echo "$f:$n: $kind"; found=0; done < <(grep -nIE "${KINDS[$kind]}" -- "$f" 2>/dev/null | cut -d: -f1)
  done
  return $found
}
status=0
while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  scan "$f" && status=1
done < <(git ls-files -z --cached --others --exclude-standard)
if [ "${1:-}" = "--ignored" ]; then
  while IFS= read -r -d '' f; do
    case "$f" in node_modules/*|*/node_modules/*|dist/*|*/dist/*|.git/*) continue ;; esac
    [ -f "$f" ] || continue
    scan "$f" | sed 's/$/  (ignored file: local only)/'
  done < <(git ls-files -z --others --ignored --exclude-standard)
fi
[ "$status" = 0 ] && echo "no credential-shaped strings in files git would share"
exit "$status"
