# Event cover images. Browsers PUT directly here via presigned URLs from the
# event service — bytes never enter the cluster (SYSTEM-DESIGN.md §6).
#
# This is the *uploads* bucket only. The static SPA bundle gets its own bucket in
# 20-platform (or wherever CloudFront is wired up in week 4).
#
# --- why the bucket is not an `aws_s3_bucket` resource -----------------------
# The Learner Lab service control policy (p-lfgm2hv3) explicitly denies
# `s3:GetBucketObjectLockConfiguration`. The AWS provider calls that API on every
# read of an `aws_s3_bucket` resource, so managing the bucket that way makes
# every `plan`/`apply` fail. Probed 2026-09-07; it is the ONLY blocked S3 read.
#
# Workaround: create the bucket with the CLI (idempotent, via terraform_data so
# `terraform apply` is still the single entry point) and manage all of its
# *configuration* through the granular `aws_s3_bucket_*` resources below, which
# use targeted APIs the SCP permits. Report talking point: a probed environment
# constraint that pushed one line of provisioning out of the provider while
# keeping the whole configuration in IaC.

resource "terraform_data" "uploads_bucket" {
  triggers_replace = [local.uploads_bucket, var.region]

  provisioner "local-exec" {
    command = <<-EOT
      aws s3api head-bucket --bucket ${local.uploads_bucket} 2>/dev/null \
        || aws s3api create-bucket --bucket ${local.uploads_bucket} --region ${var.region}
    EOT
  }
}

data "aws_s3_bucket" "uploads" {
  bucket     = local.uploads_bucket
  depends_on = [terraform_data.uploads_bucket]
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = data.aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Disable ACLs entirely — presigned URLs are IAM-authorised, no ACL needed.
resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = data.aws_s3_bucket.uploads.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = data.aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The CORS policy that lets a browser PUT to a presigned URL. Getting this wrong
# is the classic silent failure (PROJECT-KNOWLEDGE-BASE.md §4) — a browser PUT
# fails with no useful error. ExposeHeaders(ETag) lets the SPA confirm the upload.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = data.aws_s3_bucket.uploads.id

  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = var.uploads_cors_allowed_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Cover images are disposable (re-seeded every rebuild); no versioning.
# But clean up multipart uploads the browser abandons mid-PUT.
resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = data.aws_s3_bucket.uploads.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
