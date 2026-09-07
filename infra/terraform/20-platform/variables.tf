variable "account_id" {
  description = "AWS account ID. Guards against applying with stale credentials for another account."
  type        = string
  default     = "735838417080"
}

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
