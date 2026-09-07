data "aws_caller_identity" "current" {}

# --- 10-foundation outputs ------------------------------------------------
# The custom domain (Route 53 zone + ACM cert) lives in the permanent layer.
# Read it here so the NLB gets a TLS listener and an ALIAS record re-pointed at
# the fresh load balancer on every rebuild. All three collapse to "" until
# 10-foundation is applied with `dns_domain` set — then `dns_enabled` flips and
# nlb.tf / route53.tf switch from plain-TCP passthrough to TLS.
data "terraform_remote_state" "foundation" {
  backend = "s3"
  config = {
    bucket = "eventide-tfstate-735838417080"
    key    = "10-foundation/terraform.tfstate"
    region = "us-east-1"
  }
}

locals {
  acm_certificate_arn = try(data.terraform_remote_state.foundation.outputs.acm_certificate_arn, "")
  route53_zone_id     = try(data.terraform_remote_state.foundation.outputs.route53_zone_id, "")
  public_host         = try(data.terraform_remote_state.foundation.outputs.public_host, "")
  dns_enabled         = local.acm_certificate_arn != "" && local.route53_zone_id != ""
}

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
