#!/usr/bin/env bash
# Delete the local k3d cluster and its registry. The local analogue of
# scripts/teardown.sh — but with no cloud bill attached, so there is no
# verification sweep: `k3d cluster delete` removes the node containers, the
# serverlb and the managed registry in one go.
set -euo pipefail

CLUSTER=eventide

if k3d cluster list -o json | grep -q "\"name\":\"${CLUSTER}\""; then
  k3d cluster delete "${CLUSTER}"
  echo "k3d cluster '${CLUSTER}' deleted."
else
  echo "no k3d cluster '${CLUSTER}' — nothing to do."
fi
