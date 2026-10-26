# Consumed by scripts/deploy.sh, scripts/teardown.sh and the README.

output "account_id" {
  value = local.account_id
}

output "region" {
  value = var.region
}

output "ecr_registry" {
  description = "Registry host — prefix for every image push/pull."
  value       = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

output "ecr_repository_urls" {
  description = "Full push/pull URL per image."
  value       = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

output "uploads_bucket" {
  description = "S3 bucket for uploaded files (avatars, event covers/assets); public/* is readable, served as /files/* by the ingress."
  value       = data.aws_s3_bucket.uploads.id
}

output "mail_queue_url" {
  description = "SQS queue URL for @app/mail — deploy.sh puts it in the eventide-common k8s Secret as MAIL_QUEUE_URL."
  value       = aws_sqs_queue.mail.url
}

# --- Custom domain (dns.tf) — all "" / [] when dns_domain is unset ------------
output "public_host" {
  description = "Single host the deployed system is served at, e.g. events.example.com."
  value       = local.zone_name
}

output "public_url" {
  description = "https://<public_host> when DNS is on, else \"\" — deploy.sh falls back to http://<alb>."
  value       = local.dns_enabled ? "https://${local.zone_name}" : ""
}

output "route53_name_servers" {
  description = "Paste these 4 NS records into Cloudflare for the delegated subdomain, once."
  value       = local.dns_enabled ? aws_route53_zone.app[0].name_servers : []
}

output "acm_certificate_arn" {
  description = "Wildcard cert ARN. PENDING_VALIDATION until the NS delegation is live."
  value       = local.dns_enabled ? aws_acm_certificate.app[0].arn : ""
}

# --- Optional third-party secrets — Secrets Manager names, "" when disabled ----
output "google_oauth_secret" {
  value = local.google_oauth_enabled ? "${var.project}/google-oauth" : ""
}

output "stripe_secret" {
  value = local.stripe_enabled ? "${var.project}/stripe" : ""
}

output "gmail_secret" {
  value = local.gmail_enabled ? "${var.project}/gmail" : ""
}

# --- Platform (modules/platform) — "" while platform = false -------------------
output "cluster_name" {
  value = try(module.platform[0].cluster_name, "")
}

output "configure_kubectl" {
  description = "Run this after `make up` to talk to the cluster."
  value       = var.platform ? "aws eks update-kubeconfig --region ${var.region} --name ${var.project}" : ""
}

output "alb_dns_name" {
  description = "Public ALB hostname → ingress-nginx. `curl http://<this>/api/events/health` after deploy."
  value       = try(module.platform[0].alb_dns_name, "")
}

output "rds_endpoint" {
  value = try(module.platform[0].rds_endpoint, "")
}

output "rds_master_secret_arn" {
  description = "Secrets Manager ARN with DATABASE_URL + BETTER_AUTH_SECRET — scripts/deploy.sh reads it."
  value       = try(module.platform[0].rds_master_secret_arn, "")
}

output "endpoints_secret_arn" {
  description = "Secrets Manager ARN with DATABASE_URL (RDS Proxy), DATABASE_MIGRATE_URL (direct) and REDIS_URL."
  value       = try(module.platform[0].endpoints_secret_arn, "")
}
