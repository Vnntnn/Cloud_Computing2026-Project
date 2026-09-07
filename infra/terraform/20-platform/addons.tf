# Cluster add-ons that rarely change and die with the cluster anyway → managed
# by Terraform so one `apply` yields a cluster that's ready to receive the app.
# The app itself (image tag changes every commit) stays in scripts/deploy.sh.

# Token is generated client-side from the current AWS credentials (STS) — no
# extra IAM permissions, refreshed on every plan/apply.
data "aws_eks_cluster_auth" "this" {
  name = aws_eks_cluster.this.name
}

# helm provider v3: `kubernetes` is an attribute (`= {`), not a nested block.
provider "helm" {
  kubernetes = {
    host                   = aws_eks_cluster.this.endpoint
    cluster_ca_certificate = base64decode(aws_eks_cluster.this.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.this.token
  }
}

# ingress-nginx as a NodePort Service — the NLB above forwards :80/:443 to the
# NodePorts in infra/helm/ingress-nginx.values.yaml (30080/30443). See that file
# for why NodePort and not type=LoadBalancer.
resource "helm_release" "ingress_nginx" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  version          = "4.15.1"
  namespace        = "ingress-nginx"
  create_namespace = true

  values = [file("${path.module}/../../helm/ingress-nginx.values.yaml")]

  # Needs schedulable nodes + working DNS.
  depends_on = [
    aws_eks_node_group.default,
    aws_eks_addon.coredns,
  ]

  wait    = true
  timeout = 300
}

# --- Week 4: autoscaling + observability -------------------------------
# metrics-server feeds the HPA (infra/k8s/event-hpa.yaml). Without it the HPA
# reports `<unknown>/60%` and never scales. Not an EKS managed add-on — install
# via Helm.
#
# `--kubelet-insecure-tls`: EKS 1.33 signs kubelet serving certs off the cluster
# CA, but the SANs don't always cover the address metrics-server dials, and a
# lab cluster isn't the place to debug it. Acceptable for a graded demo; you
# would not do this in production.
resource "helm_release" "metrics_server" {
  name             = "metrics-server"
  repository       = "https://kubernetes-sigs.github.io/metrics-server/"
  chart            = "metrics-server"
  version          = "3.12.2"
  namespace        = "kube-system"
  create_namespace = false

  set = [
    { name = "args[0]", value = "--kubelet-insecure-tls" },
    { name = "args[1]", value = "--kubelet-preferred-address-types=InternalIP\\,Hostname\\,ExternalIP" },
  ]

  depends_on = [aws_eks_node_group.default, aws_eks_addon.coredns]

  wait    = true
  timeout = 300
}

# External Secrets Operator — reconciles the chart's ExternalSecret resources
# (infra/helm/eventide, eso.enabled=true) into Kubernetes Secrets, reading AWS
# Secrets Manager. The operator + its CRDs must exist before `helm upgrade
# eventide` applies any ExternalSecret, so it is installed here with the cluster,
# not by scripts/deploy.sh.
#
# Auth: the ClusterSecretStore points at a Secret of static session credentials
# that deploy.sh refreshes each session (`eventide-aws-creds`). The lab node role
# carries no `secretsmanager:GetSecretValue` and `iam:AttachRolePolicy` is denied
# (docs/lab-probe-2026-09-07.txt), so IMDS auth is not an option — same
# constraint that forces injected creds on the `event` pod for S3 (§5.3).
resource "helm_release" "external_secrets" {
  name             = "external-secrets"
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  version          = "2.10.0"
  namespace        = "external-secrets"
  create_namespace = true

  set = [
    { name = "installCRDs", value = "true" },
    # Single-node-friendly: no leader-election replica pile-up on a 2-node lab.
    { name = "replicaCount", value = "1" },
    { name = "webhook.replicaCount", value = "1" },
    { name = "certController.replicaCount", value = "1" },
  ]

  depends_on = [
    aws_eks_node_group.default,
    aws_eks_addon.coredns,
  ]

  wait    = true
  timeout = 300
}

# CloudWatch Container Insights — pod CPU/memory graphs for the report
# (SYSTEM-DESIGN.md §10). The `amazon-cloudwatch-observability` add-on runs a
# CloudWatch-agent + fluent-bit DaemonSet that needs `CloudWatchAgentServerPolicy`.
#
# GATED OFF by default: that policy reaches the agent either via IRSA (denied —
# no `iam:CreateOpenIDConnectProvider`) or by being attached to the node role
# `LabEksNodeRole`. Whether `iam:AttachRolePolicy` is permitted is still unprobed
# (docs/lab-probe-2026-09-06.txt "NOT YET PROBED"). Before flipping this on:
#
#   ROLE=$(aws eks describe-nodegroup --cluster-name eventide --nodegroup-name default \
#            --query 'nodegroup.nodeRole' --output text | awk -F/ '{print $NF}')
#   aws iam list-attached-role-policies --role-name "$ROLE"      # already has it?
#   aws iam attach-role-policy --role-name "$ROLE" \
#     --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy   # if not
#
# If neither works, the report falls back to `kubectl top pods` + the HPA event
# log for the scaling evidence, which is enough. Container Insights is a nicety,
# not a GATE.
resource "aws_eks_addon" "cloudwatch_observability" {
  count = var.enable_container_insights ? 1 : 0

  cluster_name = aws_eks_cluster.this.name
  addon_name   = "amazon-cloudwatch-observability"

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.default]
}
