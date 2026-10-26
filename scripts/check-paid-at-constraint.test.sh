#!/usr/bin/env bash
# bash scripts/check-paid-at-constraint.test.sh [scratch db] — the constraint script against a SCRATCH database (default mig_phase5): `check`
# changes nothing, `validate` is refused without confirmation, on a violating row, and for the main database, and goes through once the
# violating row is held (not repaired: its paid_at stays empty). Needs docker compose's postgres; resets the constraint to NOT VALID first.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
DB="${1:-mig_phase5}"; S=scripts/check-paid-at-constraint.sh
q() { echo "$1" | docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d "$DB" -At 2>&1; }
fail() { echo "FAIL: $1"; exit 1; }
[ "$DB" != "db" ] && [ "$DB" != "${POSTGRES_DB:-db}" ] || fail "this test needs a scratch database, not the main one"
docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-postgres}" >/dev/null 2>&1 || { echo "BLOCKED: postgres from docker compose is not running"; exit 0; }
[ -n "$(q "select 1 from pg_database where datname = '$DB'" | head -1)" ] || { echo "BLOCKED: no scratch database $DB"; exit 0; }
validated() { q "select convalidated from pg_constraint where conname = 'payments_paid_at_check'"; }

# a known starting point: constraint present, NOT VALID, no probe rows
q "delete from payments where stripe_session_id = 'cs_legacy_check'" >/dev/null
q "alter table payments drop constraint if exists payments_paid_at_check" >/dev/null
q "alter table payments add constraint payments_paid_at_check check (status not in ('paid','refunded') or paid_at is not null or recovery_hold is not null) not valid" >/dev/null
[ "$(validated)" = "f" ] || fail "setup: the constraint should start NOT VALID"

# 1. check is read-only
before="$(q "select count(*) from payments")"
out="$(bash $S check "$DB")"; echo "$out" | grep -q "violating rows in $DB: 0" || fail "check should report 0 violators: $out"
[ "$(validated)" = "f" ] && [ "$(q "select count(*) from payments")" = "$before" ] || fail "check changed something"

# 2. validate is refused without the confirmation, without a name, and for a mismatch
bash $S validate >/dev/null 2>&1; [ $? = 2 ] || fail "validate with no database must be refused"
bash $S validate "$DB" >/dev/null 2>&1; [ $? = 2 ] || fail "validate without CONFIRM_DB must be refused"
CONFIRM_DB=somethingelse bash $S validate "$DB" >/dev/null 2>&1; [ $? = 2 ] || fail "validate with the wrong CONFIRM_DB must be refused"
[ "$(validated)" = "f" ] || fail "a refused validate must change nothing"

# 3. a legacy malformed row: validation is refused and nothing is changed
q "alter table payments drop constraint payments_paid_at_check" >/dev/null
q "insert into payments (enrollment_id, stripe_session_id, checkout_url, amount, status, expires_at) select id, 'cs_legacy_check', 'x', '1.00', 'paid', now() from enrollments limit 1" >/dev/null
q "alter table payments add constraint payments_paid_at_check check (status not in ('paid','refunded') or paid_at is not null or recovery_hold is not null) not valid" >/dev/null
out="$(bash $S check "$DB")"; echo "$out" | grep -q "violating rows in $DB: 1" || fail "check should find the malformed row: $out"
out="$(CONFIRM_DB="$DB" bash $S validate "$DB" 2>&1)"; rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q "refusing: 1 row" || fail "validate must refuse while a row violates it (rc=$rc): $out"
[ "$(validated)" = "f" ] || fail "a refused validate must leave the constraint NOT VALID"

# 4. held for review (no timestamp invented): it no longer violates, validation goes through, and the row is exactly as it was plus the hold
q "update payments set recovery_hold = 'inconsistent' where stripe_session_id = 'cs_legacy_check'" >/dev/null
out="$(CONFIRM_DB="$DB" bash $S validate "$DB" 2>&1)" || fail "validate should go through once the row is held: $out"
[ "$(validated)" = "t" ] || fail "the constraint should be validated now"
[ "$(q "select paid_at is null from payments where stripe_session_id = 'cs_legacy_check'")" = "t" ] || fail "no payment time may be made up"

# 5. a new malformed write is still refused, and the scratch database is left as it was found
q "insert into payments (enrollment_id, stripe_session_id, checkout_url, amount, status, expires_at) select id, 'cs_new_check', 'x', '1.00', 'paid', now() from enrollments limit 1" | grep -q "violates check constraint" || fail "a new malformed row must be refused"
q "delete from payments where stripe_session_id in ('cs_legacy_check','cs_new_check')" >/dev/null
echo "check-paid-at-constraint.test.sh: 5 pass (scratch database $DB)"
