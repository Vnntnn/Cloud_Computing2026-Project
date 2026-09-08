# Consumed by 20-platform (via terraform_remote_state or -var), by scripts/deploy.sh,
# and by the ESO ClusterSecretStore config.

output "account_id" {
  value = var.account_id
}

output "region" {
  value = var.region
}

output "ecr_registry" {
  description = "Registry host — prefix for every image push/pull."
  value       = "${var.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

output "ecr_repository_urls" {
  description = "Full push/pull URL per service."
  value       = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

output "uploads_bucket" {
  description = "S3 bucket for event cover images (presigned PUT/GET)."
  value       = data.aws_s3_bucket.uploads.id
}

output "uploads_bucket_arn" {
  value = data.aws_s3_bucket.uploads.arn
}

output "secret_arns" {
  description = "Secrets Manager ARN per service — referenced by ESO ExternalSecret resources."
  value       = { for k, s in aws_secretsmanager_secret.service : k => s.arn }
}

# --- Custom domain (dns.tf) — consumed by 20-platform via terraform_remote_state.
# All empty / [] when dns_domain is unset.

output "public_host" {
  description = "Single host the deployed system is served at, e.g. events.example.com."
  value       = local.zone_name
}

output "public_url" {
  description = "https://<public_host> — feed to deploy.sh as PUBLIC_URL (JWT iss/aud, BETTER_AUTH_URL)."
  value       = local.dns_enabled ? "https://${local.zone_name}" : ""
}

output "route53_zone_id" {
  description = "Hosted zone ID — 20-platform adds the NLB ALIAS record here each rebuild."
  value       = local.dns_enabled ? aws_route53_zone.app[0].zone_id : ""
}

output "route53_name_servers" {
  description = "Paste these 4 NS records into Cloudflare for the delegated subdomain, once."
  value       = local.dns_enabled ? aws_route53_zone.app[0].name_servers : []
}

output "acm_certificate_arn" {
  description = "Wildcard cert ARN for the NLB TLS listener (20-platform/nlb.tf). PENDING_VALIDATION until the NS delegation is live."
  value       = local.dns_enabled ? aws_acm_certificate.app[0].arn : ""
}

output "google_oauth_secret" {
  description = "Secrets Manager name holding the Google OAuth client id/secret, or \"\" when Google sign-in is disabled. scripts/deploy.sh reads it into eventide-auth."
  # nonsensitive(): the *name* is fixed and public; only the secret value is sensitive.
  value = nonsensitive(local.google_oauth_enabled) ? "${var.project}/google-oauth" : ""
}
