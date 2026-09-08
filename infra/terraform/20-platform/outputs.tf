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

output "public_url" {
  description = <<-EOT
    Custom-domain URL when 10-foundation has DNS enabled, else "". deploy.sh uses
    it as PUBLIC_URL (JWT iss/aud, BETTER_AUTH_URL). DNS may take a few minutes to
    propagate after apply; the cert must already be ISSUED.
  EOT
  value       = local.dns_enabled ? "https://${local.public_host}" : ""
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
