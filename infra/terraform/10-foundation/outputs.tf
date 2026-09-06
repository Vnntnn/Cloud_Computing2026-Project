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
