# WAF on the ALB. Starts in COUNT mode (var.waf_mode): the managed rules inspect request
# bodies, and this app posts multipart uploads, rich-text HTML and Stripe's raw webhook body,
# all classic false-positive sources. Run the real flows, read the per-rule counts
# (CloudWatch AWS/WAFV2 or `aws wafv2 get-sampled-requests`), then flip to "block".
#
#   0 allow  Stripe webhook path: the signature check in the payment service authenticates it
#   1 rate   per-IP request ceiling (var.waf_rate_limit per 5 min)
#   2 managed Common (OWASP-style; body rules skipped for multipart uploads, which the
#             services size-limit and sniff themselves), KnownBadInputs, IP reputation
locals {
  waf_block = var.waf_mode == "block"
}

resource "aws_wafv2_web_acl" "edge" {
  name        = "${var.project}-edge"
  description = "ALB protection for ${var.project}"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "allow-stripe-webhook"
    priority = 0
    action {
      allow {}
    }
    statement {
      byte_match_statement {
        search_string         = "/api/payment/webhook"
        positional_constraint = "STARTS_WITH"
        field_to_match {
          uri_path {}
        }
        text_transformation {
          priority = 0
          type     = "NONE"
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "allow-stripe-webhook"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 1
    action {
      dynamic "block" {
        for_each = local.waf_block ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = local.waf_block ? [] : [1]
        content {}
      }
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "managed-common"
    priority = 2
    override_action {
      dynamic "none" {
        for_each = local.waf_block ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = local.waf_block ? [] : [1]
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # multipart uploads (avatar, event cover, event assets) are binary and over 8 KB:
        # SizeRestrictions_BODY and the pattern rules would trip on every one
        scope_down_statement {
          not_statement {
            statement {
              byte_match_statement {
                search_string         = "multipart/form-data"
                positional_constraint = "CONTAINS"
                field_to_match {
                  single_header {
                    name = "content-type"
                  }
                }
                text_transformation {
                  priority = 0
                  type     = "LOWERCASE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "managed-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "managed-known-bad-inputs"
    priority = 3
    override_action {
      dynamic "none" {
        for_each = local.waf_block ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = local.waf_block ? [] : [1]
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "managed-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "managed-ip-reputation"
    priority = 4
    override_action {
      dynamic "none" {
        for_each = local.waf_block ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = local.waf_block ? [] : [1]
        content {}
      }
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "managed-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-edge"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "edge" {
  resource_arn = aws_lb.edge.arn
  web_acl_arn  = aws_wafv2_web_acl.edge.arn
}
