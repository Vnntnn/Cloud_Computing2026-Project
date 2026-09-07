# Custom domain — a subdomain delegated to Route 53, apex stays on Cloudflare
# (SYSTEM-DESIGN.md §5.5.1 option 2, chosen 2026-09-07).
#
# Lives in 10-foundation, NOT 20-platform, on purpose:
#   * The hosted zone's NS records are pasted into Cloudflare BY HAND, once. If
#     the zone were recreated every nightly rebuild the NS set would change and
#     the delegation would break daily.
#   * ACM DNS validation persists with the zone — the cert issues once and is
#     reused across every platform rebuild.
#
# 20-platform reads `acm_certificate_arn` / `route53_zone_id` / `public_host`
# from this layer's remote state and (re)points an ALIAS record at the fresh NLB
# on each `make up`.
#
# Disabled by default (`dns_domain = ""`): a plain `terraform apply` here creates
# zero DNS resources. Set the domain in `dns.auto.tfvars` (gitignored) to enable.

variable "dns_domain" {
  description = <<-EOT
    Apex domain registered at Cloudflare, e.g. "example.com". Empty (the default)
    disables every DNS/TLS resource in this file. Set it in dns.auto.tfvars.
  EOT
  type        = string
  default     = ""
}

variable "dns_subdomain" {
  description = <<-EOT
    Label delegated to this Route 53 hosted zone. The deployed system is served
    at "<dns_subdomain>.<dns_domain>" over a single host (SPA at /, APIs at
    /api/*). NS records for this name are set at Cloudflare by hand, once.
  EOT
  type        = string
  default     = "events"
}

locals {
  dns_enabled = var.dns_domain != ""
  zone_name   = local.dns_enabled ? "${var.dns_subdomain}.${var.dns_domain}" : ""
}

resource "aws_route53_zone" "app" {
  count   = local.dns_enabled ? 1 : 0
  name    = local.zone_name
  comment = "eventide — delegated subdomain; apex stays on Cloudflare (SYSTEM-DESIGN §5.5.1 option 2)"
}

# One wildcard cert covers the single host today and any future host under the
# delegated zone without re-validation. us-east-1 = same region as the NLB (an
# ELBv2 TLS listener requires the cert in its own region).
resource "aws_acm_certificate" "app" {
  count                     = local.dns_enabled ? 1 : 0
  domain_name               = local.zone_name
  subject_alternative_names = ["*.${local.zone_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# The CNAMEs ACM needs to prove domain control. These resolve — and the cert
# moves PENDING_VALIDATION -> ISSUED — only once the Cloudflare NS delegation is
# live. ACM retries for 72h, so the order "apply -> set NS at Cloudflare -> wait"
# is fine; no second apply is required.
resource "aws_route53_record" "acm_validation" {
  for_each = local.dns_enabled ? {
    for dvo in aws_acm_certificate.app[0].domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}

  zone_id         = aws_route53_zone.app[0].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}
