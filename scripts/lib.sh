#!/usr/bin/env bash
# Shared by scripts/deploy.sh and scripts/k3d-up.sh. Tested by scripts/lib.test.sh.

# Dockerfile path for an image name.
dockerfile_for() { case "$1" in db-bootstrap) echo packages/db/Dockerfile ;; *) echo "apps/$1/Dockerfile" ;; esac; }

# helm --set arguments pinning image tags: one per service image in the list,
# plus the migrate Job's when db-bootstrap is in it. Driven by the SAME list the
# build loop uses, so a partial build (IMAGES="event web") never points a
# Deployment at a tag that was not pushed.
#   helm_tag_sets <tag> <image>...
helm_tag_sets() {
  local tag="$1"; shift
  local out=() img
  for img in "$@"; do
    case "$img" in
      db-bootstrap) out+=("--set" "dbMigrate.image.tag=$tag") ;;
      *) out+=("--set" "services.$img.image.tag=$tag") ;;
    esac
  done
  echo "${out[*]}"
}

# The chart's deployments that deploy.sh / k3d-up.sh build images for (redis is a public image).
APP_SERVICES="auth event registration payment mail-worker web"

# For a SUBSET build: pin every service NOT in the list to the tag it runs right
# now (a plain --set would reset it to the chart default `latest`, which is never
# pushed), and skip the migrate hook when no migrate image was built.
#   keep_sets <image>...
keep_sets() {
  local out=() s cur
  for s in $APP_SERVICES; do
    case " $* " in *" $s "*) continue ;; esac
    cur="$(kubectl -n eventide get deploy "$s" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | sed 's/.*://')"
    [ -n "$cur" ] && out+=("--set" "services.$s.image.tag=$cur")
  done
  case " $* " in *" db-bootstrap "*) ;; *) out+=("--set" "dbMigrate.enabled=false") ;; esac
  echo "${out[*]}"
}

# --- AWS entry points ---------------------------------------------------------
# infra/aws.env holds the Learner Lab session credentials (see infra/aws.env.example).
load_aws_env() {
  local f="${ROOT:-.}/infra/aws.env"
  if [ -f "$f" ]; then set -a; . "$f"; set +a; fi
  : "${AWS_DEFAULT_REGION:=us-east-1}"; export AWS_DEFAULT_REGION
}
tf() { terraform -chdir="${ROOT:-.}/infra/terraform" "$@"; }
tfout() { tf output -raw "$1" 2>/dev/null; }

# --- teardown verification ----------------------------------------------------------
# verify_empty <label> <command...>: runs the command and checks that it printed nothing. A command
# that FAILS (AccessDenied: the lab cut the credentials) counts as UNVERIFIED, not as empty: that
# silence is how a half-finished `make down` once looked clean. Sets VERIFY_BAD=1 on anything else.
VERIFY_BAD=0
verify_empty() {
  local label="$1" out rc; shift
  out="$("$@" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '  UNVERIFIED   %s: %s\n' "$label" "$(printf '%s' "$out" | head -n1 | cut -c1-110)"; VERIFY_BAD=1
  elif [ -n "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
    printf '  STILL THERE  %s: %s\n' "$label" "$(printf '%s' "$out" | tr '\n\t' '  ')"; VERIFY_BAD=1
  else
    printf '  gone         %s\n' "$label"
  fi
}
