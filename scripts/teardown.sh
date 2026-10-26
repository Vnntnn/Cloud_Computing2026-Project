#!/usr/bin/env bash
# Turn the platform off (`platform = false` in the single Terraform root) and PROVE it is gone.
#
# The lab auto-stops EC2 only. RDS, the EKS control plane and ELBs keep billing,
# and the worker-node ASG relaunches lab-stopped instances. Leaving the platform
# up between sessions exhausts the $50 cap in ~15 days. Run this at the END of
# EVERY session and read the verification block.
#
# Usage: bash scripts/teardown.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib.sh"
load_aws_env

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
# the production layout bills hourly for these too (NAT, endpoints, cache, proxy, WAF)
echo "--- NAT gateways (not deleted) ---"
aws ec2 describe-nat-gateways --filter Name=state,Values=available,pending,deleting \
  --query 'NatGateways[].NatGatewayId' --output text
echo "--- Elastic IPs ---"
aws ec2 describe-addresses --query 'Addresses[].PublicIp' --output text
echo "--- VPC interface endpoints ---"
aws ec2 describe-vpc-endpoints --filters Name=vpc-endpoint-type,Values=Interface \
  --query 'VpcEndpoints[].ServiceName' --output text
echo "--- ElastiCache replication groups ---"
aws elasticache describe-replication-groups --query 'ReplicationGroups[].ReplicationGroupId' --output text
echo "--- RDS proxies ---"
aws rds describe-db-proxies --query 'DBProxies[].DBProxyName' --output text
echo "--- WAF web ACLs (regional) ---"
aws wafv2 list-web-acls --scope REGIONAL --query 'WebACLs[].Name' --output text
echo "--- CloudWatch alarms / dashboards ---"
aws cloudwatch describe-alarms --alarm-name-prefix eventide- --query 'MetricAlarms[].AlarmName' --output text
aws cloudwatch list-dashboards --dashboard-name-prefix eventide --query 'DashboardEntries[].DashboardName' --output text
echo
echo "If any line above is non-empty, something survived. Find it now — check the"
echo "lab credit remaining (expect ~\$1.10/session; more means a resource is still up)."
