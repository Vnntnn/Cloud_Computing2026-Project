# Raw aws_eks_* resources, NOT terraform-aws-modules/eks.
#
# Why not the module: every version of it reads `data "aws_iam_session_context"
# "current"` unconditionally, which calls `iam:GetRole` on the caller's role to
# resolve the STS session ARN. The Learner Lab policy `Pvoclabs2` puts an
# EXPLICIT DENY on `iam:GetRole` for the `voclabs` role, so `terraform plan`
# fails before it creates anything. There is no module flag to skip that data
# source (checked v19–v21.25, and reproduced directly). Probed 2026-09-07.
#
# The native `access_config.bootstrap_cluster_creator_admin_permissions` resolves
# the creating principal SERVER-SIDE inside the EKS API — no IAM read on the
# client — which is exactly what we need. Report talking point: a community
# module's convenience feature is unusable under the lab's IAM restrictions;
# hand-writing the two core resources sidesteps it.

resource "aws_eks_cluster" "this" {
  name     = var.project
  version  = var.kubernetes_version
  role_arn = local.eks_cluster_role_arn

  # Managed addons only (see aws_eks_addon below); don't also install the
  # self-managed copies or they fight.
  bootstrap_self_managed_addons = false

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  vpc_config {
    # two AZs are mandatory; only the first holds nodes
    subnet_ids              = [var.edge_subnet_id, var.egress_subnet_id, var.cp_subnet_id]
    endpoint_public_access  = true # kubectl/helm from the laptop (no bastion or VPN)
    endpoint_private_access = true # node <-> API stays in-VPC: the edge tier has no other way
  }

  # Control-plane logging is a week-4 (Container Insights) concern and needs
  # logs:CreateLogGroup — left off for now to keep the apply surface small.

  tags = { Name = var.project }
}

# --- Addons ---------------------------------------------------------------
# vpc-cni must be healthy before nodes join, so it is created before the node
# group. coredns needs nodes to schedule onto, so it comes after.

resource "aws_eks_addon" "vpc_cni" {
  cluster_name  = aws_eks_cluster.this.name
  addon_name    = "vpc-cni"
  addon_version = null # let EKS pick the default for the cluster version

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "kube-proxy"

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}

resource "aws_eks_addon" "coredns" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "coredns"

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.edge]
}

# --- Managed node groups -------------------------------------------------
# Two tiers, as in the architecture diagram. A pod lives in its node's subnet (vpc-cni),
# so the tier is the node group and the chart pins services with `nodeSelector`:
#   edge   no route to the internet: ingress-nginx, event, registration, web
#   egress NAT route: the services that call out (Google OAuth, Stripe, Gmail SMTP)
resource "aws_eks_node_group" "edge" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "edge"
  node_role_arn   = local.eks_node_role_arn
  subnet_ids      = [var.edge_subnet_id]

  ami_type       = "AL2023_x86_64_STANDARD"
  capacity_type  = "ON_DEMAND"
  instance_types = [var.node_instance_type]
  disk_size      = 20

  labels = { "eventide/tier" = "edge" }

  scaling_config {
    min_size     = var.node_min_size
    max_size     = var.node_max_size
    desired_size = var.node_desired_size
  }

  update_config {
    max_unavailable = 1
  }

  # CNI + kube-proxy must exist first or nodes come up NotReady with no pod networking
  # (bootstrap_self_managed_addons = false means nothing else installs them). The
  # endpoints must exist too: with no NAT, a node can't register or pull without them.
  depends_on = [aws_eks_addon.vpc_cni, aws_eks_addon.kube_proxy, aws_vpc_endpoint.interface]

  lifecycle {
    # desired_size drifts when the HPA-driven node scaling moves it; don't fight it
    ignore_changes = [scaling_config[0].desired_size]
  }
}

resource "aws_eks_node_group" "egress" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "egress"
  node_role_arn   = local.eks_node_role_arn
  subnet_ids      = [var.egress_subnet_id]

  ami_type       = "AL2023_x86_64_STANDARD"
  capacity_type  = "ON_DEMAND"
  instance_types = [var.node_instance_type]
  disk_size      = 20

  labels = { "eventide/tier" = "egress" }

  scaling_config {
    min_size     = var.egress_node_min_size
    max_size     = var.egress_node_max_size
    desired_size = var.egress_node_desired_size
  }

  update_config {
    max_unavailable = 1
  }

  depends_on = [aws_eks_addon.vpc_cni, aws_eks_addon.kube_proxy, aws_route.egress_default]

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }
}

# --- ALB -> NodePort ---------------------------------------------------
# Managed node groups attach the cluster primary security group to every node. Open the
# ingress-nginx HTTP NodePort on it to the load balancer's security group, and to nothing else.
resource "aws_vpc_security_group_ingress_rule" "alb_nodeport" {
  security_group_id            = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  description                  = "ALB to ingress-nginx HTTP NodePort"
  ip_protocol                  = "tcp"
  from_port                    = var.ingress_http_nodeport
  to_port                      = var.ingress_http_nodeport
  referenced_security_group_id = aws_security_group.alb.id
}

locals {
  node_security_group_id = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
  edge_autoscaling_group = one(aws_eks_node_group.edge.resources[0].autoscaling_groups[*].name)
}
