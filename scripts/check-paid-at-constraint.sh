#!/usr/bin/env bash
# payments_paid_at_check (migrations 0012-0015, added NOT VALID): a paid or refunded payment must have paid_at, unless it is held
# for recovery review (recovery_hold set). docs/tickets.md §10 has the per-environment runbook.
#
#   scripts/check-paid-at-constraint.sh check [db]      read-only: rows that violate the constraint, and whether it is validated
#   scripts/check-paid-at-constraint.sh probe <scratch> every statement in a transaction that is rolled back, on a SCRATCH copy:
#                                                       VALIDATE on clean data, VALIDATE with a malformed legacy row (must fail),
#                                                       a hold written to that row (allowed), any other write to it (refused)
#   CONFIRM_DB=<db> scripts/check-paid-at-constraint.sh validate <db>   ALTER TABLE ... VALIDATE CONSTRAINT, only if `check` finds no violator
# Local docker compose only (postgres service). For a cluster, run the same SQL with psql against its DATABASE_URL.
set -euo pipefail
# docker compose picks its project from the directory: always this repository's
cd "$(dirname "$0")/.."
mode="${1:-check}"; db="${2:-db}"
psql_() { docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d "$1" -v ON_ERROR_STOP=0 -At; }
# every operand is non-null (status is NOT NULL, IS NOT NULL never yields NULL), so NOT (...) cannot be NULL
VIOLATORS="select count(*) from payments where not (status not in ('paid','refunded') or paid_at is not null or recovery_hold is not null)"

case "$mode" in
  check)
    echo "violating rows in $db: $(echo "$VIOLATORS" | psql_ "$db")"
    echo "validated: $(echo "select convalidated from pg_constraint where conname = 'payments_paid_at_check'" | psql_ "$db")"
    ;;
  validate)
    # the one command here that changes anything: the database must be named, and named again in CONFIRM_DB, so a typo can't pick it
    [ -n "${2:-}" ] || { echo "validate needs the database name: validate <db> (and CONFIRM_DB=<db>)"; exit 2; }
    [ "${CONFIRM_DB:-}" = "$db" ] || { echo "refusing: set CONFIRM_DB=$db to validate in $db"; exit 2; }
    [ "$(echo "select current_database()" | psql_ "$db")" = "$db" ] || { echo "connected to a different database than $db"; exit 1; }
    n="$(echo "$VIOLATORS" | psql_ "$db")"
    [ "$n" = "0" ] || { echo "refusing: $n row(s) violate the constraint in $db; resolve them first (they are not repaired here)"; exit 1; }
    echo "ALTER TABLE payments VALIDATE CONSTRAINT payments_paid_at_check" | psql_ "$db"
    echo "validated: $(echo "select convalidated from pg_constraint where conname = 'payments_paid_at_check'" | psql_ "$db")"
    ;;
  probe)
    [[ "$db" =~ ^[A-Za-z0-9_]+$ ]] || { echo "not a database name: $db"; exit 1; }
    main="${POSTGRES_DB:-db}"
    { [ "$db" != "$main" ] && [ "$db" != "db" ]; } || { echo "probe runs on a scratch copy, never on $main"; exit 1; }
    # whatever the argument said, check which database the session really is in
    [ "$(echo "select current_database()" | psql_ "$db")" = "$db" ] || { echo "connected to a different database than $db"; exit 1; }
    [ "$(echo "select count(*) from enrollments" | psql_ "$db")" -gt 0 ] || { echo "the scratch copy has no enrollment to attach the probe rows to"; exit 1; }
    failed=0
    expect() { # label, output, what it must contain
      case "$2" in *"$3"*) echo "   ok: $1" ;; *) echo "   FAIL: $1 (expected '$3' in: $2)"; failed=1 ;; esac
    }
    run() { psql_ "$db" 2>&1 | tr '\n' ' '; }
    drop="alter table payments drop constraint payments_paid_at_check;"
    legacy="insert into payments (enrollment_id, stripe_session_id, checkout_url, amount, status, expires_at) select id, 'cs_legacy_probe', 'x', '1.00', 'paid', now() from enrollments limit 1;"
    readd="alter table payments add constraint payments_paid_at_check check (status not in ('paid','refunded') or paid_at is not null or recovery_hold is not null) not valid;"

    echo "1) validate on the current data"
    out="$(printf 'begin;\nalter table payments validate constraint payments_paid_at_check;\nselect convalidated from pg_constraint where conname=%s;\nrollback;\n' "'payments_paid_at_check'" | run)"
    expect "clean data validates" "$out" " t "
    echo "2) a legacy malformed row, then validate (must fail)"
    out="$(printf 'begin;\n%s\n%s\n%s\nalter table payments validate constraint payments_paid_at_check;\nrollback;\n' "$drop" "$legacy" "$readd" | run)"
    expect "a malformed row fails validation" "$out" "violated by some row"
    echo "3) the same row: a hold can be written"
    out="$(printf 'begin;\n%s\n%s\n%s\nupdate payments set recovery_hold=%s where stripe_session_id=%s;\nselect status, paid_at is null, recovery_hold from payments where stripe_session_id=%s;\nrollback;\n' "$drop" "$legacy" "$readd" "'inconsistent'" "'cs_legacy_probe'" "'cs_legacy_probe'" | run)"
    expect "a hold is allowed" "$out" "paid|t|inconsistent"
    echo "4) the same row: any other write is refused"
    out="$(printf 'begin;\n%s\n%s\n%s\nupdate payments set recovery_attempts=5 where stripe_session_id=%s;\nrollback;\n' "$drop" "$legacy" "$readd" "'cs_legacy_probe'" | run)"
    expect "another write is refused" "$out" "violates check constraint"
    echo "5) a new malformed write is refused"
    out="$(printf 'begin;\ninsert into payments (enrollment_id, stripe_session_id, checkout_url, amount, status, expires_at) select id, %s, %s, %s, %s, now() from enrollments limit 1;\nrollback;\n' "'cs_new_bad'" "'x'" "'1.00'" "'paid'" | run)"
    expect "a new malformed row is refused" "$out" "violates check constraint"
    left="$(echo "select count(*) from payments where stripe_session_id in ('cs_legacy_probe','cs_new_bad')" | psql_ "$db")"
    [ "$left" = "0" ] || { echo "   FAIL: $left probe row(s) left behind"; failed=1; }
    echo "   state after: constraint validated = $(echo "select convalidated from pg_constraint where conname = 'payments_paid_at_check'" | psql_ "$db")"
    [ "$failed" = "0" ] || exit 1
    ;;
  *) echo "usage: $0 check [db] | probe <scratch db> | validate [db]"; exit 2 ;;
esac
