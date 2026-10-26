#!/usr/bin/env bash
# Recover the Terraform state after an interrupted run. Called by scripts/tf-init.sh (so by `make up`,
# `make deploy`) and by scripts/teardown.sh (`make down`), before anything touches the state.
#
# What an interruption leaves behind (it happened when the lab cut the credentials in the middle of
# `make down`: the destroy was half done, S3 then refused every write):
#   1. errored.tfstate   Terraform's copy of the state it could not upload. It is the newest truth;
#                        running `apply` without it forks the state.
#   2. a stale lock      eventide/terraform.tfstate.tflock in the state bucket, because releasing
#                        the lock was refused too. Every later command stops on it.
#
# What this does, in that order:
#   - lock: removed only when no terraform process runs on this machine and the lock is older than
#     LOCK_MIN_AGE seconds (default 300), so a live run on another machine is not broken.
#   - errored.tfstate: pushed (and renamed *.pushed-<time>) when it belongs to this account and is
#     newer than the remote state of the same lineage, or when there is no remote state; archived
#     (*.foreign-/*.stale-<time>, never deleted) when it is from another account or not newer.
#     A lineage mismatch or a failed push stops with exit 1: that needs a human.
# Nothing to recover -> silent, exit 0. No credentials -> skipped (the caller fails on its own).
#
#   bash scripts/recover-state.sh
# Overrides (the tests use them): TF_DIR (where errored.tfstate lives), LOCK_MIN_AGE.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"
load_aws_env

TF_DIR="${TF_DIR:-$ROOT/infra/terraform}"
ERRORED="$TF_DIR/errored.tfstate"
LOCK_MIN_AGE="${LOCK_MIN_AGE:-300}"
KEY="eventide/terraform.tfstate"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
say() { echo "recover-state: $*"; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || { say "no valid AWS credentials, skipping"; exit 0; }
BUCKET="eventide-tfstate-$ACCOUNT"

# ---- 1. a stale lock ------------------------------------------------------------------------
if aws s3api head-object --bucket "$BUCKET" --key "$KEY.tflock" >/dev/null 2>&1; then
  BODY="$(aws s3 cp "s3://$BUCKET/$KEY.tflock" - 2>/dev/null || true)"
  CREATED="$(printf '%s' "$BODY" | jq -r '.Created // empty' 2>/dev/null || true)"
  WHO="$(printf '%s' "$BODY" | jq -r '.Who // "?"' 2>/dev/null || echo '?')"
  OP="$(printf '%s' "$BODY" | jq -r '.Operation // "?"' 2>/dev/null || echo '?')"
  AGE=999999
  [ -n "$CREATED" ] && AGE=$(( $(date -u +%s) - $(date -u -d "$CREATED" +%s 2>/dev/null || echo 0) ))
  if pgrep -x terraform >/dev/null 2>&1; then
    say "the state is locked and a terraform process is running on this machine: leaving the lock alone"
    exit 1
  elif [ "$AGE" -lt "$LOCK_MIN_AGE" ]; then
    say "the state is locked by '$WHO' ($OP) for only ${AGE}s: it may be a live run elsewhere. Retry in a few minutes"
    exit 1
  fi
  aws s3 rm "s3://$BUCKET/$KEY.tflock" >/dev/null
  say "removed a stale state lock ($OP by $WHO, created $CREATED)"
fi

# ---- 2. errored.tfstate ---------------------------------------------------------------------
[ -f "$ERRORED" ] || exit 0

archive() { mv "$ERRORED" "$ERRORED.$1-$STAMP"; say "$2 (kept as $(basename "$ERRORED").$1-$STAMP)"; }
LOCAL_ACCOUNT="$(jq -r '.outputs.account_id.value // empty' "$ERRORED" 2>/dev/null || true)"
LOCAL_SERIAL="$(jq -r '.serial // -1' "$ERRORED" 2>/dev/null || echo -1)"
LOCAL_LINEAGE="$(jq -r '.lineage // empty' "$ERRORED" 2>/dev/null || true)"

if [ -n "$LOCAL_ACCOUNT" ] && [ "$LOCAL_ACCOUNT" != "$ACCOUNT" ]; then
  archive foreign "errored.tfstate is from account $LOCAL_ACCOUNT, this is $ACCOUNT: not pushing it"
  exit 0
fi

REMOTE="$(tf state pull 2>/dev/null || true)"
if printf '%s' "$REMOTE" | jq -e '.serial' >/dev/null 2>&1; then
  REMOTE_SERIAL="$(printf '%s' "$REMOTE" | jq -r '.serial')"
  REMOTE_LINEAGE="$(printf '%s' "$REMOTE" | jq -r '.lineage')"
  if [ -n "$LOCAL_LINEAGE" ] && [ "$LOCAL_LINEAGE" != "$REMOTE_LINEAGE" ]; then
    say "errored.tfstate and the remote state have different lineages: one of them is from another life of this project."
    say "decide by hand: 'terraform state push -force errored.tfstate' keeps the saved one, deleting it keeps the remote one"
    exit 1
  fi
  if [ "$LOCAL_SERIAL" -le "$REMOTE_SERIAL" ]; then
    archive stale "errored.tfstate (serial $LOCAL_SERIAL) is not newer than the remote state (serial $REMOTE_SERIAL): not pushing it"
    exit 0
  fi
  say "pushing errored.tfstate (serial $LOCAL_SERIAL) over the remote state (serial $REMOTE_SERIAL)"
else
  say "there is no remote state yet: pushing errored.tfstate (serial $LOCAL_SERIAL)"
fi

if tf state push -lock-timeout=60s "$ERRORED"; then
  mv "$ERRORED" "$ERRORED.pushed-$STAMP"
  say "state recovered (the saved copy is kept as $(basename "$ERRORED").pushed-$STAMP)"
else
  say "FAILED to push errored.tfstate. Fix the cause (credentials? lock?) and run this again; do NOT run terraform apply first (it would fork the state)" >&2
  exit 1
fi
