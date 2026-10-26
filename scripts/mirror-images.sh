#!/usr/bin/env bash
# Copy the two public images Terraform's Helm releases install into our ECR, once per tag.
# The edge node tier has no route to the internet, so it can't pull from registry.k8s.io.
# The ECR repos are permanent (infra/terraform/ecr.tf), so this survives `make down`;
# re-run it only when a tag below changes. Needs: docker (buildx) + the lab credentials.
#
#   bash scripts/mirror-images.sh        (make mirror)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"
load_aws_env

REG="$(tfout ecr_registry)"
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$REG" >/dev/null

# <source> <ECR repo>   (keep the tags in step with infra/terraform/platform.tf's chart versions)
while read -r src repo; do
  echo "== $src -> $REG/$repo =="
  docker buildx imagetools create --tag "$REG/$repo" "$src"
done <<LIST
registry.k8s.io/ingress-nginx/controller:v1.15.1 k8s/ingress-nginx-controller:v1.15.1
registry.k8s.io/metrics-server/metrics-server:v0.7.2 k8s/metrics-server:v0.7.2
LIST
