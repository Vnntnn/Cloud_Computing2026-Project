variable "region" {
  description = "AWS region. Learner Lab is us-east-1 only."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for every resource / the EKS cluster name."
  type        = string
  default     = "eventide"
}

# --- the nightly switch ------------------------------------------------------
variable "platform" {
  description = <<-EOT
    true  = EKS + RDS + NLB + ingress-nginx + metrics-server exist (make up).
    false = exactly those are destroyed; ECR, S3, SQS, secrets and DNS stay (make down).
    The lab auto-stops EC2 only — RDS, the EKS control plane and the NLB keep
    billing, so this must be false at the end of every session.
  EOT
  type        = bool
  default     = true
}

# --- platform sizing (passed through to modules/platform) ---------------------
variable "availability_zones" {
  description = "AZs to pin to. us-east-1e routinely lacks capacity; three is enough."
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
    Managed node group instance type. t3.small keeps EC2 cost low (~11 pods/node
    via the VPC CNI). The HPA-to-8 load test wants t3.medium (~17 pods/node):
    `NODE_INSTANCE_TYPE=t3.medium make up`.
  EOT
  type        = string
  default     = "t3.small"
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  description = "Headroom for the HPA demo even on t3.small."
  type        = number
  default     = 4
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "egress_node_min_size" {
  description = "Nodes of the NAT-egress tier (auth, payment, mail-worker)."
  type        = number
  default     = 1
}

variable "egress_node_max_size" {
  type    = number
  default = 2
}

variable "egress_node_desired_size" {
  type    = number
  default = 1
}

variable "ingress_http_nodeport" {
  description = "NodePort ingress-nginx exposes for HTTP (infra/helm/ingress-nginx.values.yaml). The NLB forwards :80 here, and :443 after TLS termination."
  type        = number
  default     = 30080
}

variable "ingress_https_nodeport" {
  description = "NodePort ingress-nginx exposes for HTTPS. Only the pre-domain :443 TCP passthrough uses it."
  type        = number
  default     = 30443
}

variable "enable_container_insights" {
  description = "Install the amazon-cloudwatch-observability add-on. OFF by default — see modules/platform/cloudwatch.tf for the IAM probe it needs."
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

# --- images (ecr.tf) ---------------------------------------------------------
variable "services" {
  description = "The microservices that each get an ECR repo."
  type        = list(string)
  default     = ["auth", "event", "registration", "payment", "mail-worker"]
}

variable "tool_images" {
  description = "Non-service images that get an ECR repo (the migrate Job, the static SPA)."
  type        = list(string)
  default     = ["db-bootstrap", "web"]
}

variable "waf_mode" {
  description = "WAF on the ALB: \"count\" (log what would be blocked) or \"block\" (enforce). Counted for the first session (2026-10-26) and flipped once the real flows showed no false positives; use count again when adding a feature that posts unusual bodies."
  type        = string
  default     = "block"
}

variable "waf_rate_limit" {
  description = "Requests per 5 minutes from one IP before the WAF rate rule acts. Raise it for a single-source load test."
  type        = number
  default     = 10000
}

variable "alert_email" {
  description = "Email subscribed to the CloudWatch alarms' SNS topic (eventide-alerts). Empty = nobody; the topic and alarms still exist. AWS sends a confirmation mail first."
  type        = string
  default     = ""
}
