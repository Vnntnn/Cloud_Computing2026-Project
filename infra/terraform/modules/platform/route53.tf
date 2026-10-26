# The one DNS record that changes per rebuild: an ALIAS from the delegated zone
# apex (events.<domain>) to whatever ALB this apply just created. The hosted zone
# and the ACM cert are permanent at the root (dns.tf); only this pointer is
# ephemeral, and Terraform re-points it automatically — no Cloudflare API call,
# no manual step (SYSTEM-DESIGN.md §5.5.1 option 2).
#
# Single-host design: this apex serves the SPA at / and the APIs at /api/* via
# one ingress. No api./app. split, so no CORS.

resource "aws_route53_record" "app" {
  count   = local.dns_enabled ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.public_host
  type    = "A"

  alias {
    name                   = aws_lb.edge.dns_name
    zone_id                = aws_lb.edge.zone_id
    evaluate_target_health = true
  }

  # point the name at the ALB only once a node is registered behind it
  depends_on = [aws_autoscaling_attachment.ingress, aws_wafv2_web_acl_association.edge]
}
