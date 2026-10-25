# --- The nightly layer: EKS + RDS + ALB/WAF, plus the cluster add-ons --------------
# `platform = false` (make down) destroys exactly this module and the two helm
# releases below, nothing else. `platform = true` (make up, the default) brings
# them back. ECR, S3, SQS, the secrets and DNS in the other files stay — the
# permanent layer and the nightly layer share one state.
module "platform" {
  count  = var.platform ? 1 : 0
  source = "./modules/platform"

  project                   = var.project
  region                    = var.region
  availability_zones        = var.availability_zones
  vpc_id                    = aws_vpc.main.id
  vpc_cidr                  = local.vpc_cidr
  public_subnet_ids         = [aws_subnet.this["public_a"].id, aws_subnet.this["public_b"].id]
  edge_subnet_id            = aws_subnet.this["edge_a"].id
  egress_subnet_id          = aws_subnet.this["egress_a"].id
  cp_subnet_id              = aws_subnet.this["cp_b"].id
  data_subnet_ids           = [aws_subnet.this["data_a"].id, aws_subnet.this["data_b"].id]
  egress_route_table_id     = aws_route_table.this["egress"].id
  kubernetes_version        = var.kubernetes_version
  node_instance_type        = var.node_instance_type
  node_min_size             = var.node_min_size
  node_max_size             = var.node_max_size
  node_desired_size         = var.node_desired_size
  alert_email               = var.alert_email
  mail_queue_name           = aws_sqs_queue.mail.name
  mail_dlq_name             = aws_sqs_queue.mail_dlq.name
  waf_mode                  = var.waf_mode
  waf_rate_limit            = var.waf_rate_limit
  egress_node_min_size      = var.egress_node_min_size
  egress_node_max_size      = var.egress_node_max_size
  egress_node_desired_size  = var.egress_node_desired_size
  ingress_http_nodeport     = var.ingress_http_nodeport
  ingress_https_nodeport    = var.ingress_https_nodeport
  enable_container_insights = var.enable_container_insights
  db_instance_class         = var.db_instance_class
  db_engine_version         = var.db_engine_version
  db_allocated_storage      = var.db_allocated_storage

  # Permanent DNS resources (dns.tf); "" = off → plain-http ALB, no ALIAS record.
  acm_certificate_arn = local.dns_enabled ? aws_acm_certificate.app[0].arn : ""
  route53_zone_id     = local.dns_enabled ? aws_route53_zone.app[0].zone_id : ""
  public_host         = local.zone_name
}

# ingress-nginx as a NodePort Service — the ALB forwards to the
# NodePorts in infra/helm/ingress-nginx.values.yaml (30080/30443). See that file
# for why NodePort and not type=LoadBalancer. Lives at the root because a
# provider (helm) cannot be configured inside a counted module.
resource "helm_release" "ingress_nginx" {
  count            = var.platform ? 1 : 0
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  version          = "4.15.1"
  namespace        = "ingress-nginx"
  create_namespace = true

  values = [file("${path.module}/../helm/ingress-nginx.values.yaml")]

  # The edge nodes have no route to the internet, so the controller image comes from
  # our ECR (scripts/mirror-images.sh), not registry.k8s.io.
  set = [
    { name = "controller.image.registry", value = local.ecr_registry },
    { name = "controller.image.image", value = "k8s/ingress-nginx-controller" },
    # the ALB sits in the VPC: trust X-Forwarded-For from there only, so the real client IP reaches the apps
    { name = "controller.config.proxy-real-ip-cidr", value = local.vpc_cidr },
  ]

  # Needs schedulable nodes + working DNS (coredns is inside the module).
  depends_on = [module.platform]

  wait    = true
  timeout = 300
}

# metrics-server feeds the event HPA. Without it the HPA reports `<unknown>/60%`
# and never scales. `--kubelet-insecure-tls`: EKS kubelet serving certs don't
# always cover the address metrics-server dials; acceptable for a graded demo.
resource "helm_release" "metrics_server" {
  count            = var.platform ? 1 : 0
  name             = "metrics-server"
  repository       = "https://kubernetes-sigs.github.io/metrics-server/"
  chart            = "metrics-server"
  version          = "3.12.2"
  namespace        = "kube-system"
  create_namespace = false

  set = [
    { name = "image.repository", value = "${local.ecr_registry}/k8s/metrics-server" },
    { name = "image.tag", value = "v0.7.2" },
    { name = "nodeSelector.eventide/tier", value = "edge" },
    { name = "args[0]", value = "--kubelet-insecure-tls" },
    { name = "args[1]", value = "--kubelet-preferred-address-types=InternalIP\\,Hostname\\,ExternalIP" },
  ]

  depends_on = [module.platform]

  wait    = true
  timeout = 300
}

# NB: no External Secrets Operator. IRSA is unavailable and the node role can't
# read Secrets Manager, so ESO would need a static-credential secretRef that
# expires every session — scripts/deploy.sh builds the k8s Secrets instead
# (SYSTEM-DESIGN §5.2.1). The chart keeps the ESO templates behind `eso.enabled`.
