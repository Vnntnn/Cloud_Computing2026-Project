output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "cluster_ca" {
  description = "Base64 CA bundle — the root's helm provider decodes it."
  value       = aws_eks_cluster.this.certificate_authority[0].data
}

output "node_group_id" {
  description = "Exists so the root's helm releases can depend on schedulable nodes."
  value       = aws_eks_node_group.edge.id
}

output "node_security_group_id" {
  value = local.node_security_group_id
}

output "alb_dns_name" {
  description = "Public ALB hostname → ingress-nginx. `curl http://<this>/api/events/health` after deploy."
  value       = aws_lb.edge.dns_name
}

output "waf_acl_name" {
  value = aws_wafv2_web_acl.edge.name
}

output "rds_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "rds_address" {
  value = aws_db_instance.main.address
}

output "rds_master_secret_arn" {
  description = "Secrets Manager ARN with DATABASE_URL + BETTER_AUTH_SECRET — scripts/deploy.sh reads it."
  value       = aws_secretsmanager_secret.db_master.arn
}

output "endpoints_secret_arn" {
  description = "Secrets Manager ARN with DATABASE_URL (proxy), DATABASE_MIGRATE_URL (direct) and REDIS_URL - scripts/deploy.sh reads it."
  value       = aws_secretsmanager_secret.endpoints.arn
}

output "rds_proxy_endpoint" {
  value = aws_db_proxy.main.endpoint
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}
