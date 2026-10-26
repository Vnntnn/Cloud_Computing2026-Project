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
# If neither works, `kubectl top pods` + the HPA event log are enough scaling
# evidence. Container Insights is a nicety, not a GATE.
resource "aws_eks_addon" "cloudwatch_observability" {
  count = var.enable_container_insights ? 1 : 0

  cluster_name = aws_eks_cluster.this.name
  addon_name   = "amazon-cloudwatch-observability"

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.edge]
}
