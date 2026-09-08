# One secret per service (SYSTEM-DESIGN.md §5.2). On EKS the External Secrets
# Operator reads these and materialises Kubernetes Secrets; locally, the same
# manifests are fed by `kubectl create secret` from a file. The app only ever
# sees process.env.
#
# There is deliberately NO shared JWT signing key here — event/registration fetch
# public keys from auth's JWKS endpoint at runtime (SYSTEM-DESIGN.md §5.1).

resource "aws_secretsmanager_secret" "service" {
  for_each = toset(var.services)

  name        = "${var.project}/${each.key}"
  description = "Runtime env for the ${each.key} service — the ESO source when eso.enabled (off in the lab; deploy.sh builds the k8s Secret from eventide/rds-master instead — SYSTEM-DESIGN §5.2.1)."

  # Lab iteration: allow immediate recreation, don't hold a 7-30 day recovery
  # window on a secret name we might need to recreate.
  recovery_window_in_days = 0
}

# Seed one version so the key shape is discoverable. Real values are written
# out-of-band; Terraform ignores every change after creation and will not clobber
# them on the next apply.
resource "aws_secretsmanager_secret_version" "service" {
  for_each = aws_secretsmanager_secret.service

  secret_id     = each.value.id
  secret_string = jsonencode(local.secret_templates[each.key])

  lifecycle {
    ignore_changes = [secret_string]
  }
}
