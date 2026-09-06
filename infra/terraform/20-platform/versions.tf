terraform {
  required_version = ">= 1.10"

  # Destroyed and recreated every session — see scripts/teardown.sh.
  backend "s3" {
    bucket       = "eventide-tfstate-735838417080"
    key          = "20-platform/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
  }
}
