# The load balancer is built by Terraform, targeting the node group — NOT a
# Kubernetes `Service type=LoadBalancer`, whose ELB is invisible to Terraform
# state and hangs `destroy` on the VPC for ~20 min before failing
# (SYSTEM-DESIGN.md §2.2, PROJECT-KNOWLEDGE-BASE.md §4).
#
# ingress-nginx runs as a NodePort Service (installed via Helm in week 1 Day 3);
# this NLB forwards :80 to its HTTP NodePort as plain TCP. :443 is a TLS listener
# terminating the ACM cert (10-foundation/dns.tf) and forwarding plain HTTP to
# the same HTTP NodePort — once the custom domain is wired. Until then :443 is a
# plain-TCP passthrough to ingress-nginx's own HTTPS NodePort.

resource "aws_lb" "ingress" {
  name               = "${var.project}-ingress"
  load_balancer_type = "network"
  internal           = false
  subnets            = data.aws_subnets.abc.ids

  enable_cross_zone_load_balancing = true
}

resource "aws_lb_target_group" "http" {
  name        = "${var.project}-ingress-http"
  port        = var.ingress_http_nodeport
  protocol    = "TCP"
  target_type = "instance"
  vpc_id      = data.aws_vpc.default.id

  health_check {
    protocol            = "TCP"
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 10
  }

  # ingress-nginx keeps a client's connections on one node
  stickiness {
    type    = "source_ip"
    enabled = true
  }
}

# Used only by the pre-domain passthrough listener. Idle (but harmless — health
# checks a real port) once `https_tls` takes over :443.
resource "aws_lb_target_group" "https" {
  name        = "${var.project}-ingress-https"
  port        = var.ingress_https_nodeport
  protocol    = "TCP"
  target_type = "instance"
  vpc_id      = data.aws_vpc.default.id

  health_check {
    protocol            = "TCP"
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 10
  }

  stickiness {
    type    = "source_ip"
    enabled = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.ingress.arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.http.arn
  }
}

# :443 — TLS terminated at the NLB with the ACM wildcard cert, forwarding plain
# HTTP to ingress-nginx's :80 NodePort. The origin leg (NLB -> node) is
# unencrypted but never leaves the VPC — note this in the report (§5.5.1).
resource "aws_lb_listener" "https_tls" {
  count             = local.dns_enabled ? 1 : 0
  load_balancer_arn = aws_lb.ingress.arn
  port              = 443
  protocol          = "TLS"
  certificate_arn   = local.acm_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.http.arn
  }
}

# Fallback while no cert exists: plain-TCP passthrough to ingress-nginx's own
# HTTPS NodePort (self-signed). Lets `curl -k https://<nlb>` work pre-domain.
resource "aws_lb_listener" "https_passthrough" {
  count             = local.dns_enabled ? 0 : 1
  load_balancer_arn = aws_lb.ingress.arn
  port              = 443
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.https.arn
  }
}

# Wire the node group's ASG into both target groups. As nodes are replaced by the
# ASG (lab stop/start, scaling), registration follows automatically.
resource "aws_autoscaling_attachment" "http" {
  autoscaling_group_name = local.node_autoscaling_group
  lb_target_group_arn    = aws_lb_target_group.http.arn
}

resource "aws_autoscaling_attachment" "https" {
  autoscaling_group_name = local.node_autoscaling_group
  lb_target_group_arn    = aws_lb_target_group.https.arn
}
