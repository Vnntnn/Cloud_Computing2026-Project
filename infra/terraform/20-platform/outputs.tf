output "region" {
  value = var.region
}

output "cluster_name" {
  value = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "configure_kubectl" {
  description = "Run this after apply to talk to the cluster."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${aws_eks_cluster.this.name}"
}

output "node_security_group_id" {
  value = local.node_security_group_id
}

output "nlb_dns_name" {
  description = "Public NLB hostname → ingress-nginx. The custom-domain CNAME/ALIAS targets it in week 2. `curl http://<this>/health/live` after deploy."
  value       = aws_lb.ingress.dns_name
}

output "ingress_nginx_version" {
  value = helm_release.ingress_nginx.version
}

output "rds_endpoint" {
  description = "host:port for the RDS instance."
  value       = aws_db_instance.main.endpoint
}

output "rds_address" {
  value = aws_db_instance.main.address
}

output "rds_master_secret_arn" {
  description = "Secrets Manager ARN with master creds + endpoint — input to the DB-bootstrap Job."
  value       = aws_secretsmanager_secret.db_master.arn
}
