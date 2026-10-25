# Inputs from the root: the permanent DNS resources (zone + cert) live there and
# are passed in as plain strings; "" = DNS off → the NLB stays plain TCP.
locals {
  dns_enabled = var.acm_certificate_arn != "" && var.route53_zone_id != ""
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
