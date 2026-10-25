# The public edge: an Application Load Balancer with a WAF (waf.tf), replacing the NLB
# (2026-10-25: CloudFront and Shield are denied in the lab, so the ALB + WAF are the edge).
# Built by Terraform, targeting the edge node group - NOT a Kubernetes `Service
# type=LoadBalancer`, whose ELB is invisible to Terraform state and hangs `destroy` on the
# VPC (SYSTEM-DESIGN.md 2.2). ingress-nginx stays a NodePort Service behind it.
#
#   :80   -> 301 to https
#   :443  -> TLS terminated with the ACM cert (dns.tf), plain HTTP to ingress-nginx's NodePort
#
# The ALB needs subnets in two AZs (public 1a + 1b); the targets are in 1a only.

resource "aws_security_group" "alb" {
  name        = "${var.project}-alb"
  description = "Public HTTP/HTTPS to the application load balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP (redirected to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # the VPC CIDR, not the node group: the nodes' rule already references this group
  egress {
    description = "ingress-nginx NodePort on the nodes"
    from_port   = var.ingress_http_nodeport
    to_port     = var.ingress_http_nodeport
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_lb" "edge" {
  name               = "${var.project}-edge"
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]

  # the live-seats WebSocket (/api/regis/events/:id/availability/live) idles between
  # announcements; ingress-nginx closes it after proxyTimeoutSeconds (3600), so match that
  idle_timeout               = 3600
  drop_invalid_header_fields = true
  enable_deletion_protection = false # nightly destroy
}

resource "aws_lb_target_group" "ingress" {
  name        = "${var.project}-ingress"
  port        = var.ingress_http_nodeport
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = var.vpc_id

  deregistration_delay = 30

  # ingress-nginx answers /healthz itself, independent of the apps behind it. With
  # externalTrafficPolicy Local only nodes that run a controller pod pass it.
  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  count             = local.dns_enabled ? 1 : 0
  load_balancer_arn = aws_lb.edge.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.acm_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ingress.arn
  }
}

# With a certificate :80 only redirects; without one (no domain) it forwards, so the bare ALB works over http.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.edge.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = local.dns_enabled ? "redirect" : "forward"
    target_group_arn = local.dns_enabled ? null : aws_lb_target_group.ingress.arn

    dynamic "redirect" {
      for_each = local.dns_enabled ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

# As nodes are replaced by the ASG (lab stop/start, scaling), registration follows.
resource "aws_autoscaling_attachment" "ingress" {
  autoscaling_group_name = local.edge_autoscaling_group
  lb_target_group_arn    = aws_lb_target_group.ingress.arn
}
