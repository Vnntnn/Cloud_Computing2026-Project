locals {
  # Bucket names must be globally unique — suffix with the account ID.
  uploads_bucket = "${var.project}-uploads-${var.account_id}"

  # Placeholder secret contents. Terraform creates the secret and seeds one
  # version with these keys so the shape is discoverable; the real values are
  # written out-of-band (scripts/lab-creds.sh, the AWS console, or `aws
  # secretsmanager put-secret-value`) and Terraform never overwrites them again
  # — see the ignore_changes lifecycle block in secrets.tf.
  #
  # Keys mirror SYSTEM-DESIGN.md §5.2. The app validates these with Zod at boot
  # (packages/shared/src/env.ts), so a missing key fails loudly.
  secret_templates = {
    auth = {
      DATABASE_URL         = "postgres://REPLACE_ME"
      BETTER_AUTH_SECRET   = "REPLACE_ME"
      BETTER_AUTH_URL      = "REPLACE_ME"
      GOOGLE_CLIENT_ID     = "REPLACE_ME"
      GOOGLE_CLIENT_SECRET = "REPLACE_ME"
    }
    event = {
      DATABASE_URL   = "postgres://REPLACE_ME"
      S3_BUCKET_NAME = local.uploads_bucket
    }
    registration = {
      DATABASE_URL = "postgres://REPLACE_ME"
    }
  }
}
