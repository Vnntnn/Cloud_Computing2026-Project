variable "region" {
  description = "AWS region. Learner Lab is us-east-1 only."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix / EKS cluster name."
  type        = string
  default     = "eventide"
}

variable "availability_zones" {
  description = "AZs to pin to. us-east-1e routinely lacks capacity for t3.medium and fails node groups with an opaque error; 1d is fine but three is enough."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "kubernetes_version" {
  description = "EKS control-plane version. Lab offers 1.31-1.36."
  type        = string
  default     = "1.33"
}

variable "node_instance_type" {
  description = <<-EOT
    Managed node group instance type. t3.small keeps EC2 cost low for weeks 1-3
    (~11 pods/node via the VPC CNI). The week-4 autoscaling demo (HPA to 8
    replicas, SYSTEM-DESIGN.md §10) wants the t3.medium ceiling (~17 pods/node) —
    run that load test with `-var node_instance_type=t3.medium`.
  EOT
  type        = string
  default     = "t3.small"
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  description = "Headroom for the week-4 HPA demo even on t3.small."
  type        = number
  default     = 4
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "ingress_http_nodeport" {
  description = "NodePort ingress-nginx exposes for HTTP. The NLB forwards :80 here, and also :443 after terminating TLS with the ACM cert (nlb.tf)."
  type        = number
  default     = 30080
}

variable "ingress_https_nodeport" {
  description = "NodePort ingress-nginx exposes for HTTPS. Only used by the pre-domain :443 TCP passthrough; once the custom domain is wired the NLB terminates TLS itself and forwards to the HTTP NodePort."
  type        = number
  default     = 30443
}

variable "enable_container_insights" {
  description = <<-EOT
    Install the amazon-cloudwatch-observability add-on (Container Insights) for
    pod CPU/memory graphs in the week-4 report. OFF by default: its CloudWatch
    agent needs CloudWatchAgentServerPolicy on the node role, and whether
    iam:AttachRolePolicy is permitted in the lab is unprobed. See addons.tf for
    the probe commands. `kubectl top pods` + the HPA event log cover the scaling
    evidence without it.
  EOT
  type        = bool
  default     = false
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "db_engine_version" {
  description = "RDS PostgreSQL major version."
  type        = string
  default     = "16"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

# --- from the root's dns.tf; "" = DNS off ----------------------------------
variable "acm_certificate_arn" {
  description = "Wildcard ACM cert for the NLB TLS listener, or \"\"."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Hosted zone that gets the ALIAS record to the NLB, or \"\"."
  type        = string
  default     = ""
}

variable "public_host" {
  description = "The single public host (events.<domain>), or \"\"."
  type        = string
  default     = ""
}

# --- network (built at the root, network.tf) -------------------------------
variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "public_subnet_ids" {
  description = "[1a, 1b]: the NAT gateway goes in the first, the load balancer spans both."
  type        = list(string)
}

variable "edge_subnet_id" {
  description = "Private, no default route: ingress-nginx, event, registration, web."
  type        = string
}

variable "egress_subnet_id" {
  description = "Private, default route to the NAT gateway: auth, payment, mail-worker."
  type        = string
}

variable "cp_subnet_id" {
  description = "Private subnet in the second AZ; only the EKS control-plane ENIs use it."
  type        = string
}

variable "data_subnet_ids" {
  description = "[1a, 1b]: the DB subnet group needs two AZs, the instances sit in the first."
  type        = list(string)
}

variable "egress_route_table_id" {
  description = "Route table of the egress subnet; this module adds its route to the NAT gateway."
  type        = string
}

variable "egress_node_min_size" {
  type = number
}

variable "egress_node_max_size" {
  type = number
}

variable "egress_node_desired_size" {
  type = number
}

variable "redis_node_type" {
  type    = string
  default = "cache.t3.micro"
}

variable "waf_mode" {
  description = "\"count\" records what the managed rules and the rate limit would block; \"block\" enforces them."
  type        = string
  default     = "count"

  validation {
    condition     = contains(["count", "block"], var.waf_mode)
    error_message = "waf_mode must be \"count\" or \"block\"."
  }
}

variable "waf_rate_limit" {
  description = "Requests per 5 minutes from one IP before the rate rule acts. A single-source load test needs this raised."
  type        = number
  default     = 10000
}

variable "alert_email" {
  description = "Email for the alerts SNS topic. Empty = no subscription (a subscription sends mail and must be confirmed from the inbox)."
  type        = string
  default     = ""
}

variable "mail_queue_name" {
  type = string
}

variable "mail_dlq_name" {
  type = string
}
