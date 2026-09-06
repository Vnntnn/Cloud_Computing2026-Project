# The load balancer is built by Terraform, targeting the node group — NOT a
# Kubernetes `Service type=LoadBalancer`, whose ELB is invisible to Terraform
# state and hangs `destroy` on the VPC for ~20 min before failing
# (SYSTEM-DESIGN.md §2.2, PROJECT-KNOWLEDGE-BASE.md §4).
#
# ingress-nginx runs as a NodePort Service (installed via Helm in week 1 Day 3);
# this NLB forwards :80/:443 to those NodePorts as plain TCP. Week 2 swaps the
# :443 listener for a TLS listener with an ACM cert.

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

resource "aws_lb_listener" "https" {
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
