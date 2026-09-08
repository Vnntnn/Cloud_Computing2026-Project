provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project   = "eventide"
      Layer     = "20-platform"
      ManagedBy = "terraform"
      Course    = "cloud-computing-2026"
    }
  }
}
