#!/usr/bin/env bash
# The gated way to change what the payment service runs (docs/tickets.md §10). deploy.sh and k3d-up.sh use the same functions for
# upgrades; this is the entry point for a rollback and for running the check alone.
#
#   bash scripts/release.sh gate upgrade|rollback [image]   the preflight only (image: default the running payment image)
#   bash scripts/release.sh rollback <helm revision>        preflight, payment down, helm rollback, payment up, verify
#
# EKS needs the lab credentials (infra/aws.env) and `aws eks update-kubeconfig`; `make rollback REV=<n>` does both.
# There is no flag that skips the preflight. Commands run straight against Helm/kubectl are not covered by this.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"
load_aws_env

case "${1:-}" in
  gate)
    mode="${2:?usage: release.sh gate upgrade|rollback [image]}"
    case "$mode" in upgrade|rollback) ;; *) echo "mode must be upgrade or rollback"; exit 2 ;; esac
    payment_gate "$mode" "${3:-$(payment_running_image)}"
    ;;
  rollback)
    release_rollback "${2:?usage: release.sh rollback <helm revision>}"
    ;;
  *)
    echo "usage: release.sh gate upgrade|rollback [image] | rollback <helm revision>"; exit 2
    ;;
esac
