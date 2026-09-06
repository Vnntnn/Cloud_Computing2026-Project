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
  description = "Name prefix for all resources."
  type        = string
  default     = "eventide"
}

variable "services" {
  description = "The microservices that each get an ECR repo and a Secrets Manager secret."
  type        = list(string)
  default     = ["auth", "event", "registration"]
}

variable "tool_images" {
  description = "Non-service images that get an ECR repo but no Secrets Manager secret (one-shot Jobs etc.)."
  type        = list(string)
  default     = ["db-bootstrap"]
}

variable "uploads_cors_allowed_origins" {
  description = <<-EOT
    Origins allowed to PUT/GET the uploads bucket directly via presigned URLs.
    "*" is fine for dev and the Swagger demo. Once the SPA has a real hostname
    (week 3-4), tighten this to the CloudFront / custom-domain origins.
  EOT
  type        = list(string)
  default     = ["*"]
}
