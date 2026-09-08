terraform {
  required_version = ">= 1.10"

  # State backend. The bucket is created by hand — see ../00-bootstrap/README.md.
  # use_lockfile = true → S3 conditional-write locking, no DynamoDB table.
  #
  # The bucket name is account-scoped. If you switch Learner Lab accounts, change
  # it here and in ../20-platform/versions.tf, then re-run ../00-bootstrap.
  backend "s3" {
    bucket       = "eventide-tfstate-735838417080"
    key          = "10-foundation/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80, < 7.0"
    }
  }
}
