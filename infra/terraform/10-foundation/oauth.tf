# Google OAuth client credentials for the auth service.
#
# Stable, not lab-dependent (a Google Cloud project outlives every rebuild), so
# they live in the permanent layer — same reasoning as the custom domain in
# dns.tf. Unlike the eventide/<svc> secrets, Terraform manages this one's value
# fully (no ignore_changes): the source of truth is the variable, set once in
# google.auto.tfvars (gitignored).
#
# Off by default — an empty client id creates nothing, and auth just runs
# email/password only (SYSTEM-DESIGN §5.1.1). scripts/deploy.sh reads this secret
# when it exists and merges GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET into the
# eventide-auth k8s Secret; on k3d it stays unset.

variable "google_client_id" {
  description = "Google OAuth 2.0 client ID for the auth service. Empty = Google sign-in disabled."
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 client secret. Required when google_client_id is set."
  type        = string
  default     = ""
  sensitive   = true
}

locals {
  google_oauth_enabled = var.google_client_id != "" && var.google_client_secret != ""
}

resource "aws_secretsmanager_secret" "google_oauth" {
  count                   = local.google_oauth_enabled ? 1 : 0
  name                    = "${var.project}/google-oauth"
  description             = "Google OAuth client id/secret for the auth service. Value is Terraform-managed from google_client_id / google_client_secret."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "google_oauth" {
  count     = local.google_oauth_enabled ? 1 : 0
  secret_id = aws_secretsmanager_secret.google_oauth[0].id
  secret_string = jsonencode({
    GOOGLE_CLIENT_ID     = var.google_client_id
    GOOGLE_CLIENT_SECRET = var.google_client_secret
  })
}
