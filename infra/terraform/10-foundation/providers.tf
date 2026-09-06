provider "aws" {
  region = var.region

  # Guardrail: every apply must target the account the state bucket belongs to.
  # Catches a stale-credentials mistake before it creates orphaned resources in
  # the wrong account.
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project   = "eventide"
      Layer     = "10-foundation"
      ManagedBy = "terraform"
      Course    = "cloud-computing-2026"
    }
  }
}
