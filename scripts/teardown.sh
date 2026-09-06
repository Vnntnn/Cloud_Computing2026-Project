#!/usr/bin/env bash
# Destroy the 20-platform layer and PROVE it is gone.
#
# The lab auto-stops EC2 only. RDS, the EKS control plane and ELBs keep billing,
# and the worker-node ASG relaunches lab-stopped instances. Leaving 20-platform
# up between sessions exhausts the $50 cap in ~15 days. Run this at the END of
# EVERY session and read the verification block.
#
# Usage: bash scripts/teardown.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="$ROOT/infra/terraform/20-platform"

echo "== 1. delete any Kubernetes-created load balancers (should be none — ingress is NodePort) =="
if kubectl cluster-info >/dev/null 2>&1; then
  kubectl delete ingress --all --all-namespaces --ignore-not-found --timeout=60s || true
  # any stray Service type=LoadBalancer would orphan an ELB outside Terraform state
  lbsvc=$(kubectl get svc --all-namespaces \
    -o jsonpath='{range .items[?(@.spec.type=="LoadBalancer")]}{.metadata.namespace}{" "}{.metadata.name}{"\n"}{end}' 2>/dev/null)
  if [ -n "$lbsvc" ]; then
    echo "!! found LoadBalancer Services — deleting:"; echo "$lbsvc"
    echo "$lbsvc" | while read -r ns name; do
      [ -n "$name" ] && kubectl delete svc -n "$ns" "$name" --ignore-not-found --timeout=60s || true
    done
    sleep 30 # let the CCM release the ELBs before terraform touches the VPC
  fi
else
  echo "   (no cluster reachable — skipping)"
fi

echo
echo "== 2. terraform destroy 20-platform =="
terraform -chdir="$PLATFORM" destroy -auto-approve

echo
echo "== 3. VERIFY — every list below must be empty =="
echo "--- EKS clusters ---"
aws eks list-clusters --output text
echo "--- RDS instances ---"
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text
echo "--- load balancers (v2) ---"
aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerName' --output text
echo "--- classic ELBs ---"
aws elb describe-load-balancers --query 'LoadBalancerDescriptions[].LoadBalancerName' --output text 2>/dev/null
echo "--- running EC2 instances ---"
aws ec2 describe-instances --filters Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text
echo "--- target groups ---"
aws elbv2 describe-target-groups --query 'TargetGroups[].TargetGroupName' --output text
echo
echo "If any line above is non-empty, something survived. Find it now — check the"
echo "lab credit remaining (expect ~\$1.10/session; more means a resource is still up)."
