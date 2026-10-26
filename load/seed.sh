#!/usr/bin/env bash
# Seeds one admin user + one public event with a free first_come ticket type for the load tests.
# Read-only load afterwards: nothing here enrolls or resets (those paths send real mail).
#   BASE_URL=https://host bash load/seed.sh <out.env>     # then: make admin EMAIL=loadtest@eventide.test between steps 1 and 2
set -euo pipefail
BASE="${BASE_URL:?BASE_URL}"; OUT="${1:?out file}"
EMAIL="${LOAD_EMAIL:-loadtest@eventide.test}"; PASS="${LOAD_PASSWORD:-$(head -c 18 /dev/urandom | base64 | tr -d '/+=')Aa1}"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
call() { curl -fsS -m 30 -b "$JAR" -c "$JAR" -H "origin: $BASE" -H 'content-type: application/json' "$@"; }

step="${STEP:-1}"
if [ "$step" = 1 ]; then
  call -X POST "$BASE/api/auth/sign-up/email" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Load Test\"}" >/dev/null
  umask 077; printf 'LOAD_EMAIL=%s\nLOAD_PASSWORD=%s\n' "$EMAIL" "$PASS" > "$OUT"
  echo "signed up $EMAIL; now run: make admin EMAIL=$EMAIL, then STEP=2"; exit 0
fi

. "$OUT"
call -X POST "$BASE/api/auth/sign-in/email" -d "{\"email\":\"$LOAD_EMAIL\",\"password\":\"$LOAD_PASSWORD\"}" >/dev/null
CAT=$(call -X POST "$BASE/api/events/categories" -d '{"name":"Load test","slug":"load-test"}' | jq -r .id)
START=$(date -u -d '+30 days' +%FT%TZ); END=$(date -u -d '+30 days 3 hours' +%FT%TZ)
EV=$(call -X POST "$BASE/api/events" -d "{\"title\":\"Load test event\",\"slug\":\"load-test-event\",\"categoryId\":\"$CAT\",\"venue\":\"Cluster\",\"startsAt\":\"$START\",\"endsAt\":\"$END\"}")
ID=$(echo "$EV" | jq -r .id)
call -X POST "$BASE/api/events/$ID/ticket-types" -d '{"kind":"first_come","name":"Free","price":0,"quota":1000,"maxPerUser":4,"questions":[]}' >/dev/null
call -X PATCH "$BASE/api/events/$ID" -d '{"status":"public"}' >/dev/null
TOKEN=$(awk '$6 ~ /session_token$/ {print $6"="$7}' "$JAR" | head -1)
printf 'EVENT_ID=%s\nEVENT_SLUG=load-test-event\nCOOKIE=%s\n' "$ID" "$TOKEN" >> "$OUT"
echo "seeded event $ID (cookie saved to $OUT)"
