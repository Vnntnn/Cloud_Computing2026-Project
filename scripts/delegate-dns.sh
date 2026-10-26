#!/usr/bin/env bash
# Make the public name servers of <subdomain>.<domain> match the Route 53 zone.
#
# A lab reset deletes the Route 53 zone; Terraform creates a new one with 4 NEW name
# servers, and the delegation at Cloudflare (the apex lives there) points at the old ones
# until it is replaced. Until it is, the ACM certificate cannot validate and the ALB's
# HTTPS listener cannot be created. This script closes that gap:
#
#   - already delegated correctly            -> nothing to do
#   - CLOUDFLARE_API_TOKEN set (infra/aws.env) -> replaces the NS records through the API
#   - otherwise                              -> prints the 4 names; on a terminal it then waits
#                                               until you have pasted them, else exits 3
#
# The token needs Zone:Read and DNS:Edit on the apex zone only (Cloudflare dashboard ->
# My Profile -> API Tokens -> "Edit zone DNS", restricted to that one zone). It is only
# ever passed to curl on stdin, never on a command line, and never printed.
#
#   bash scripts/delegate-dns.sh
#
# Overrides (the tests use them): DELEGATE_HOST, WANT_NS (space separated), DOH_URL,
# CF_API_BASE, DELEGATE_WAIT (seconds to wait for the public NS to change, default 300).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"
load_aws_env

HOST="${DELEGATE_HOST:-$(tfout public_host || true)}"
if [ -z "$HOST" ]; then echo "dns: no custom domain configured (dns_domain is empty) — nothing to delegate"; exit 0; fi
DOMAIN="${HOST#*.}"   # <subdomain>.<domain> -> <domain>
DOH_URL="${DOH_URL:-https://cloudflare-dns.com/dns-query}"
CF_API_BASE="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
WAIT="${DELEGATE_WAIT:-300}"

norm() { tr 'A-Z' 'a-z' | sed 's/\.$//' | sort -u | grep -v '^$' || true; }

if [ -n "${WANT_NS:-}" ]; then WANT="$(printf '%s\n' $WANT_NS | norm)"
else WANT="$(tf output -json route53_name_servers | jq -r '.[]' | norm)"; fi
[ -n "$WANT" ] || { echo "dns: the Route 53 zone has no name servers yet — apply the permanent layer first"; exit 1; }

# what the public DNS says right now (DNS-over-HTTPS: no dig/nslookup needed)
published() {
  curl -fsS --max-time 15 -H 'accept: application/dns-json' "$DOH_URL?name=$HOST&type=NS" 2>/dev/null \
    | jq -r '.Answer[]? | select(.type == 2) | .data' | norm
}

if [ "$(published)" = "$WANT" ]; then echo "dns: $HOST is already delegated to the Route 53 zone"; exit 0; fi

wait_for_match() {   # <seconds>
  local deadline=$((SECONDS + $1))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(published)" = "$WANT" ] && { echo "dns: delegation is live"; return 0; }
    sleep 15
  done
  return 1
}

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  cf() {   # <method> <path> [json body]   -> the response body; fails unless "success": true
    local out
    out="$(printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$CLOUDFLARE_API_TOKEN" \
      | curl -fsS --max-time 30 -K - -X "$1" "$CF_API_BASE$2" ${3:+--data "$3"})" || { echo "dns: Cloudflare API call failed: $1 $2" >&2; return 1; }
    [ "$(printf '%s' "$out" | jq -r '.success')" = "true" ] || { echo "dns: Cloudflare refused: $1 $2: $(printf '%s' "$out" | jq -c '.errors')" >&2; return 1; }
    printf '%s' "$out"
  }
  ZONE="$(cf GET "/zones?name=$DOMAIN" | jq -r '.result[0].id // empty')"
  [ -n "$ZONE" ] || { echo "dns: the token cannot see a Cloudflare zone named $DOMAIN" >&2; exit 1; }
  CURRENT="$(cf GET "/zones/$ZONE/dns_records?type=NS&name=$HOST&per_page=100")"
  kept=0; deleted=0; created=0
  while IFS=$'\t' read -r id content; do   # drop what is not in the new zone
    [ -n "$id" ] || continue
    if printf '%s\n' "$WANT" | grep -qxF "$(printf '%s' "$content" | norm)"; then kept=$((kept + 1))
    else cf DELETE "/zones/$ZONE/dns_records/$id" >/dev/null; deleted=$((deleted + 1)); fi
  done < <(printf '%s' "$CURRENT" | jq -r '.result[] | [.id, .content] | @tsv')
  HAVE="$(printf '%s' "$CURRENT" | jq -r '.result[].content' | norm)"
  for ns in $WANT; do                      # add what is missing
    printf '%s\n' "$HAVE" | grep -qxF "$ns" && continue
    cf POST "/zones/$ZONE/dns_records" "$(jq -nc --arg n "$HOST" --arg c "$ns" '{type: "NS", name: $n, content: $c, ttl: 300}')" >/dev/null
    created=$((created + 1))
  done
  echo "dns: Cloudflare NS records for $HOST updated (kept $kept, deleted $deleted, created $created)"
  wait_for_match "$WAIT" || echo "dns: public DNS still shows the old name servers after ${WAIT}s (caches); continuing — ACM validates from the authoritative side"
  exit 0
fi

echo "dns: $HOST is not delegated to the new Route 53 zone yet."
echo "     At Cloudflare ($DOMAIN) replace the NS records for '${HOST%%.*}' with exactly these 4:"
printf '       %s\n' $WANT
echo "     (Set CLOUDFLARE_API_TOKEN in infra/aws.env to have this done for you next time.)"
if [ -t 0 ]; then
  echo "     Waiting up to 30 min for the change to appear (Ctrl-C to stop)..."
  wait_for_match 1800 && exit 0
  echo "dns: gave up waiting" >&2
fi
exit 3
