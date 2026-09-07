# The one DNS record that changes per rebuild: an ALIAS from the delegated zone
# apex (events.<domain>) to whatever NLB this apply just created. The hosted zone
# and the ACM cert are permanent in 10-foundation; only this pointer is
# ephemeral, and Terraform re-points it automatically — no Cloudflare API call,
# no manual step (SYSTEM-DESIGN.md §5.5.1 option 2).
#
# Single-host design: this apex serves the SPA at / and the APIs at /api/* via
# one ingress. No api./app. split, so no CORS.

resource "aws_route53_record" "app" {
  count   = local.dns_enabled ? 1 : 0
  zone_id = local.route53_zone_id
  name    = local.public_host
  type    = "A"

  alias {
    name                   = aws_lb.ingress.dns_name
    zone_id                = aws_lb.ingress.zone_id
    evaluate_target_health = true
  }
}
