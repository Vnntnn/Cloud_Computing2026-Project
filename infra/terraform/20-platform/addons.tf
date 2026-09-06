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
