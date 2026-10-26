#!/usr/bin/env bash
# Seed the prepared demo (demo/seed.ts) into the running system: three accounts (admin, an approved organizer, an
# attendee), six categories with Thai and English names, and eight events covering every kind of ticket and every
# state. Idempotent: when the demo accounts exist it does nothing. `make deploy` runs it at the end, because the
# database is new every session; run it by hand with `make demo`.
#
#   make demo                                   the deployed system
#   SEED_DEMO=0 make deploy                     deploy without the demo
#   BASE_URL=http://localhost:5173 PROMOTE_CMD='cd apps/auth && bun run admin:promote {email}' bash scripts/seed-demo.sh
#                                               a local stack (bun run dev)
# The accounts' password is random and written to demo/.credentials (mode 600, gitignored); DEMO_PASSWORD sets it.
# Details and the full list: demo/README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"
load_aws_env

command -v bun >/dev/null || { echo "demo: bun is not installed; skipping the demo data (see demo/README.md)"; exit 0; }

if [ -z "${BASE_URL:-}" ]; then
  BASE_URL="$(tfout public_url || true)"
  [ -n "$BASE_URL" ] || BASE_URL="http://$(tfout alb_dns_name || true)"
  [ "$BASE_URL" != "http://" ] || { echo "demo: no deployed system found (no public_url / alb_dns_name in the Terraform outputs): run make deploy first" >&2; exit 1; }
  # promoting the demo admin runs a one-off pod: the kubeconfig must point at this cluster
  aws eks update-kubeconfig --region "${AWS_DEFAULT_REGION:-us-east-1}" --name eventide >/dev/null
fi

cd "$ROOT"
BASE_URL="$BASE_URL" exec bun demo/seed.ts
