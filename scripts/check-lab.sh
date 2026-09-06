#!/usr/bin/env bash
# Learner Lab capability probe. Prints NO secrets.
# Usage: paste lab creds into ~/.aws/credentials [default], then: bash check-lab.sh
p() { printf '\n=== %s ===\n' "$1"; }

p "IDENTITY"
aws sts get-caller-identity --output text 2>&1

p "REGION"
aws configure get region 2>&1 || echo "(unset - Learner Lab is usually us-east-1)"

p "LabRole (needed: EKS cluster + node role)"
aws iam get-role --role-name LabRole \
  --query 'Role.Arn' --output text 2>&1

p "Can we CREATE an IAM role?  (AccessDenied EXPECTED)"
aws iam create-role --role-name zz-probe-delete-me \
  --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --query 'Role.Arn' --output text 2>&1 | tail -2
aws iam delete-role --role-name zz-probe-delete-me 2>/dev/null

p "Can we create an OIDC provider?  (decides IRSA)"
aws iam list-open-id-connect-providers --output text 2>&1 | tail -2

p ">>> EKS  <<<  THE decisive one"
aws eks list-clusters --output text 2>&1

p "RDS"
aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text 2>&1

p "Secrets Manager"
aws secretsmanager list-secrets --query 'SecretList[].Name' --output text 2>&1

p "ECR"
aws ecr describe-repositories --query 'repositories[].repositoryName' --output text 2>&1

p "S3"
aws s3 ls 2>&1 | head -5

p "ECS (fallback plan A)"
aws ecs list-clusters --output text 2>&1

p "EC2 (fallback plan B: k3s)"
aws ec2 describe-instances --query 'Reservations[].Instances[].InstanceId' --output text 2>&1

printf '\n=== DONE ===\nAccessDenied / UnauthorizedOperation on a line = that service is blocked.\n'

p "Can we ATTACH a policy to the EKS node role?  (decides whether pods can skip static creds)"
NODEROLE=$(aws iam list-roles --query 'Roles[?contains(RoleName,`LabEksNodeRole`)].RoleName' --output text)
echo "node role: ${NODEROLE:-NOT FOUND}"
if [ -n "$NODEROLE" ]; then
  aws iam attach-role-policy --role-name "$NODEROLE" \
    --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess 2>&1 | tail -2
  aws iam list-attached-role-policies --role-name "$NODEROLE" \
    --query 'AttachedPolicies[].PolicyName' --output text
fi

p "Route 53 / ACM / CloudFront  (UNVERIFIED — decides the whole TLS design)"
echo "--- route53 ---";    aws route53 list-hosted-zones --query 'HostedZones[].Name' --output text 2>&1 | tail -2
echo "--- acm ---";        aws acm list-certificates --region us-east-1 --query 'CertificateSummaryList[].DomainName' --output text 2>&1 | tail -2
echo "--- cloudfront ---"; aws cloudfront list-distributions --query 'DistributionList.Quantity' --output text 2>&1 | tail -2
