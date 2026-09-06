data "aws_caller_identity" "current" {}

# --- Lab IAM roles ----------------------------------------------------------
# iam:CreateRole is denied. Reuse the roles AWS Academy pre-creates. NEVER
# hardcode the ARNs: the "c219141a…" prefix changes on every lab reset and
# differs in each teammate's account. `one()` fails loudly if the regex matches
# zero or more than one role — which is the signal that the lab was reset and
# `bash scripts/check-lab.sh` needs re-running.
data "aws_iam_roles" "eks_cluster" {
  name_regex = ".*LabEksClusterRole.*"
}

data "aws_iam_roles" "eks_node" {
  name_regex = ".*LabEksNodeRole.*"
}

locals {
  eks_cluster_role_arn = one(data.aws_iam_roles.eks_cluster.arns)
  eks_node_role_arn    = one(data.aws_iam_roles.eks_node.arns)
}

# --- Default VPC ------------------------------------------------------------
# No VPC is built. The lab's default VPC already has public subnets + an IGW,
# which removes the NAT gateway ($1.08/day and the top cause of a failed
# teardown) and ~3 min from every apply/destroy.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "abc" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availability-zone"
    values = var.availability_zones
  }
  # the default per-AZ subnet only
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}
