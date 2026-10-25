locals {
  account_id   = data.aws_caller_identity.current.account_id
  ecr_registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"

  # Bucket names must be globally unique — suffix with the account ID.
  uploads_bucket = "${var.project}-uploads-${local.account_id}"
}
