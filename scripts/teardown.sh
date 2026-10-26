#!/usr/bin/env bash
# Turn the platform off (`platform = false` in the single Terraform root) and PROVE it is gone.
#
# The lab auto-stops EC2 only. RDS, the EKS control plane and ELBs keep billing,
# and the worker-node ASG relaunches lab-stopped instances. Leaving the platform
# up between sessions exhausts the $50 cap in ~15 days. Run this at the END of
# EVERY session and read the verification block.
#
# It exits NON-ZERO unless the apply succeeded AND every list below is empty. A list that cannot be
# read (the lab cut the credentials mid-run) is "unverified", not "empty". An interrupted run leaves
# the state recoverable: the next `make down` / `make deploy` repairs it (scripts/recover-state.sh).
#
# Usage: bash scripts/teardown.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"
load_aws_env

echo "== 0. Terraform state (init + recover an interrupted run) =="
bash "$ROOT/scripts/tf-init.sh" || { echo "teardown: cannot prepare the Terraform state (see above); nothing was destroyed" >&2; exit 1; }
echo

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
echo "== 2. terraform apply -var platform=false  (destroys EKS + RDS + proxy + ElastiCache + NAT + endpoints + ALB + WAF + alarms + add-ons; keeps the free VPC, ECR/S3/SQS/secrets/DNS) =="
tf apply -auto-approve -input=false -var platform=false
APPLY_RC=$?
if [ "$APPLY_RC" -ne 0 ]; then
  echo
  echo "!! terraform apply FAILED (exit $APPLY_RC): the platform is NOT fully gone and may still be billing."
  echo "   If the credentials were cut (the lab session ended): Start Lab, put the new ones in infra/aws.env and"
  echo "   run make down again. The saved state is recovered automatically."
fi

echo
echo "== 3. VERIFY — every line must say \"gone\" =="
verify_empty "EKS clusters"                 aws eks list-clusters --output text
verify_empty "RDS instances"                aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text
verify_empty "load balancers (v2)"          aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerName' --output text
verify_empty "classic ELBs"                 aws elb describe-load-balancers --query 'LoadBalancerDescriptions[].LoadBalancerName' --output text
verify_empty "running EC2 instances"        aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query 'Reservations[].Instances[].InstanceId' --output text
verify_empty "target groups"                aws elbv2 describe-target-groups --query 'TargetGroups[].TargetGroupName' --output text
# the production layout bills hourly for these too (NAT, endpoints, cache, proxy, WAF)
verify_empty "NAT gateways"                 aws ec2 describe-nat-gateways --filter Name=state,Values=available,pending,deleting --query 'NatGateways[].NatGatewayId' --output text
verify_empty "Elastic IPs"                  aws ec2 describe-addresses --query 'Addresses[].PublicIp' --output text
verify_empty "VPC interface endpoints"      aws ec2 describe-vpc-endpoints --filters Name=vpc-endpoint-type,Values=Interface --query 'VpcEndpoints[].ServiceName' --output text
verify_empty "ElastiCache replication groups" aws elasticache describe-replication-groups --query 'ReplicationGroups[].ReplicationGroupId' --output text
verify_empty "RDS proxies"                  aws rds describe-db-proxies --query 'DBProxies[].DBProxyName' --output text
verify_empty "WAF web ACLs (regional)"      aws wafv2 list-web-acls --scope REGIONAL --query 'WebACLs[].Name' --output text
verify_empty "CloudWatch alarms"            aws cloudwatch describe-alarms --alarm-name-prefix eventide- --query 'MetricAlarms[].AlarmName' --output text
verify_empty "CloudWatch dashboards"        aws cloudwatch list-dashboards --dashboard-name-prefix eventide --query 'DashboardEntries[].DashboardName' --output text
echo
if [ "$APPLY_RC" -ne 0 ] || [ "$VERIFY_BAD" -ne 0 ]; then
  echo "make down: NOT CLEAN. Something survived or could not be checked. Until it is gone it keeps billing"
  echo "(about \$0.5/h for the production layout). Fix the cause above and run make down again."
  exit 1
fi
echo "make down: verified clean (the apply succeeded and every list above is empty)."
echo "Also check the lab credit remaining: expect about \$2 per 4-hour session; more means something is still up."
