# Alarms + one dashboard for the platform (phase 4). Container Insights stays off (the
# node role can't take the CloudWatch agent policy), so everything here comes from the
# metrics AWS publishes for the managed pieces: ALB, WAF, RDS + Proxy, ElastiCache, SQS, EC2.
# Pod CPU is `kubectl top` / the HPA. The alarms live in the platform module on purpose:
# they go away with what they watch instead of sitting in ALARM after `make down`.
#
# Notifications: an SNS topic. Email is opt-in (var.alert_email): a subscription sends mail
# and must be confirmed from the inbox, so nothing is subscribed by default.

resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alarm_actions = [aws_sns_topic.alerts.arn]

  alb_dims = { LoadBalancer = aws_lb.edge.arn_suffix }
  tg_dims  = { LoadBalancer = aws_lb.edge.arn_suffix, TargetGroup = aws_lb_target_group.ingress.arn_suffix }
  rds_dims = { DBInstanceIdentifier = aws_db_instance.main.identifier }

  # name => alarm settings. Evaluated over 1-minute periods; missing data is not a breach
  # (a quiet system publishes no 5xx datapoints at all).
  alarms = {
    alb-target-5xx = {
      description = "The apps behind the ALB answered 5xx more than 10 times in 5 minutes"
      namespace   = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", dims = local.alb_dims
      stat        = "Sum", period = 60, evaluations = 5, datapoints = 3, threshold = 3, operator = "GreaterThanOrEqualToThreshold"
    }
    alb-elb-5xx = {
      description = "The ALB itself returned 5xx (no healthy target, or a timeout)"
      namespace   = "AWS/ApplicationELB", metric = "HTTPCode_ELB_5XX_Count", dims = local.alb_dims
      stat        = "Sum", period = 60, evaluations = 3, datapoints = 2, threshold = 1, operator = "GreaterThanOrEqualToThreshold"
    }
    alb-unhealthy-targets = {
      description = "A node behind the ALB failed its health check"
      namespace   = "AWS/ApplicationELB", metric = "UnHealthyHostCount", dims = local.tg_dims
      stat        = "Maximum", period = 60, evaluations = 3, datapoints = 3, threshold = 1, operator = "GreaterThanOrEqualToThreshold"
    }
    alb-latency-p95 = {
      description = "p95 response time above 2 s for 5 minutes"
      namespace   = "AWS/ApplicationELB", metric = "TargetResponseTime", dims = local.alb_dims
      stat        = "p95", period = 60, evaluations = 5, datapoints = 5, threshold = 2, operator = "GreaterThanThreshold"
    }
    rds-cpu = {
      description = "Database CPU above 80% for 5 minutes"
      namespace   = "AWS/RDS", metric = "CPUUtilization", dims = local.rds_dims
      stat        = "Average", period = 60, evaluations = 5, datapoints = 5, threshold = 80, operator = "GreaterThanThreshold"
    }
    rds-connections = {
      description = "Over 70 of db.t3.micro's ~87 connections: the proxy should be absorbing this"
      namespace   = "AWS/RDS", metric = "DatabaseConnections", dims = local.rds_dims
      stat        = "Maximum", period = 60, evaluations = 3, datapoints = 3, threshold = 70, operator = "GreaterThanThreshold"
    }
    rds-free-memory = {
      description = "Database freeable memory under 100 MB"
      namespace   = "AWS/RDS", metric = "FreeableMemory", dims = local.rds_dims
      stat        = "Minimum", period = 60, evaluations = 5, datapoints = 5, threshold = 100 * 1024 * 1024, operator = "LessThanThreshold"
    }
    proxy-pinned-sessions = {
      description = "RDS Proxy has pinned sessions: connections stop being shared (a driver setting, e.g. prepared statements)"
      namespace   = "AWS/RDS", metric = "DatabaseConnectionsCurrentlySessionPinned", dims = { ProxyName = aws_db_proxy.main.name }
      stat        = "Maximum", period = 60, evaluations = 5, datapoints = 5, threshold = 1, operator = "GreaterThanOrEqualToThreshold"
    }
    redis-memory = {
      description = "Redis memory above 80%"
      namespace   = "AWS/ElastiCache", metric = "DatabaseMemoryUsagePercentage", dims = { CacheClusterId = one(aws_elasticache_replication_group.main.member_clusters) }
      stat        = "Maximum", period = 60, evaluations = 5, datapoints = 5, threshold = 80, operator = "GreaterThanThreshold"
    }
    redis-evictions = {
      description = "Redis is evicting keys: the cache is too small for what it holds"
      namespace   = "AWS/ElastiCache", metric = "Evictions", dims = { CacheClusterId = one(aws_elasticache_replication_group.main.member_clusters) }
      stat        = "Sum", period = 60, evaluations = 3, datapoints = 3, threshold = 1, operator = "GreaterThanOrEqualToThreshold"
    }
    redis-cpu = {
      description = "Redis engine CPU above 80% for 5 minutes"
      namespace   = "AWS/ElastiCache", metric = "EngineCPUUtilization", dims = { CacheClusterId = one(aws_elasticache_replication_group.main.member_clusters) }
      stat        = "Average", period = 60, evaluations = 5, datapoints = 5, threshold = 80, operator = "GreaterThanThreshold"
    }
    mail-dlq-not-empty = {
      description = "A mail message exhausted its retries and landed in the dead-letter queue"
      namespace   = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", dims = { QueueName = var.mail_dlq_name }
      stat        = "Maximum", period = 60, evaluations = 1, datapoints = 1, threshold = 1, operator = "GreaterThanOrEqualToThreshold"
    }
    mail-queue-backlog = {
      description = "Mail queue older than 10 minutes: the worker is down or stuck"
      namespace   = "AWS/SQS", metric = "ApproximateAgeOfOldestMessage", dims = { QueueName = var.mail_queue_name }
      stat        = "Maximum", period = 60, evaluations = 3, datapoints = 3, threshold = 600, operator = "GreaterThanThreshold"
    }
    edge-nodes-cpu = {
      description = "Edge node group CPU above 85% for 10 minutes: the HPA is out of node headroom"
      namespace   = "AWS/EC2", metric = "CPUUtilization", dims = { AutoScalingGroupName = local.edge_autoscaling_group }
      stat        = "Average", period = 60, evaluations = 10, datapoints = 10, threshold = 85, operator = "GreaterThanThreshold"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each = local.alarms

  alarm_name          = "${var.project}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dims
  period              = each.value.period
  evaluation_periods  = each.value.evaluations
  datapoints_to_alarm = each.value.datapoints
  threshold           = each.value.threshold
  comparison_operator = each.value.operator
  treat_missing_data  = "notBreaching"

  # p95 is an extended statistic, the rest are plain
  statistic          = contains(["p95"], each.value.stat) ? null : each.value.stat
  extended_statistic = contains(["p95"], each.value.stat) ? each.value.stat : null

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

# WAF: blocks are expected (that is its job), so a rate alarm instead of "any block":
# a burst of them means someone is probing, or a rule started catching real traffic.
resource "aws_cloudwatch_metric_alarm" "waf_blocks" {
  alarm_name          = "${var.project}-waf-blocked-burst"
  alarm_description   = "More than 100 requests blocked by the WAF in 5 minutes: probing, or a rule catching real traffic"
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  dimensions          = { WebACL = aws_wafv2_web_acl.edge.name, Region = var.region, Rule = "ALL" }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 1
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

locals {
  waf_dims = ["WebACL", aws_wafv2_web_acl.edge.name, "Region", var.region, "Rule", "ALL"]
  redis_id = one(aws_elasticache_replication_group.main.member_clusters)

  # one widget = [x, y, w, h] on a 24-column grid
  dashboard_widgets = [
    { type = "text", x = 0, y = 0, width = 24, height = 2, properties = { markdown = "# ${var.project}\nEdge (ALB + WAF) · data (RDS + Proxy, ElastiCache) · mail queue · nodes. Alarms: `${var.project}-*` in CloudWatch, notifications on the `${var.project}-alerts` SNS topic. Pod CPU: `kubectl top pods`, `kubectl get hpa`." } },
    { type = "metric", x = 0, y = 2, width = 8, height = 6, properties = {
      title = "ALB requests and 5xx", region = var.region, stat = "Sum", period = 60, view = "timeSeries",
      metrics = [
        ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.edge.arn_suffix, { label = "requests" }],
        [".", "HTTPCode_Target_5XX_Count", ".", ".", { label = "target 5xx", color = "#d62728" }],
        [".", "HTTPCode_ELB_5XX_Count", ".", ".", { label = "ALB 5xx", color = "#ff7f0e" }],
    ] } },
    { type = "metric", x = 8, y = 2, width = 8, height = 6, properties = {
      title = "ALB latency (p50 / p95 / p99)", region = var.region, period = 60, view = "timeSeries",
      metrics = [
        ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.edge.arn_suffix, { stat = "p50", label = "p50" }],
        ["...", { stat = "p95", label = "p95" }],
        ["...", { stat = "p99", label = "p99" }],
    ] } },
    { type = "metric", x = 16, y = 2, width = 8, height = 6, properties = {
      title = "Targets behind the ALB", region = var.region, stat = "Maximum", period = 60, view = "timeSeries",
      metrics = [
        ["AWS/ApplicationELB", "HealthyHostCount", "LoadBalancer", aws_lb.edge.arn_suffix, "TargetGroup", aws_lb_target_group.ingress.arn_suffix, { label = "healthy" }],
        [".", "UnHealthyHostCount", ".", ".", ".", ".", { label = "unhealthy", color = "#d62728" }],
    ] } },
    { type = "metric", x = 0, y = 8, width = 8, height = 6, properties = {
      title = "WAF: allowed / counted / blocked", region = var.region, stat = "Sum", period = 60, view = "timeSeries",
      metrics = [
        concat(["AWS/WAFV2", "AllowedRequests"], local.waf_dims, [{ label = "allowed" }]),
        concat(["AWS/WAFV2", "CountedRequests"], local.waf_dims, [{ label = "counted" }]),
        concat(["AWS/WAFV2", "BlockedRequests"], local.waf_dims, [{ label = "blocked", color = "#d62728" }]),
    ] } },
    { type = "metric", x = 8, y = 8, width = 8, height = 6, properties = {
      title = "RDS Proxy: client vs database connections", region = var.region, stat = "Maximum", period = 60, view = "timeSeries",
      metrics = [
        ["AWS/RDS", "ClientConnections", "ProxyName", aws_db_proxy.main.name, { label = "client (apps -> proxy)" }],
        [".", "DatabaseConnections", ".", ".", { label = "database (proxy -> RDS)" }],
        [".", "DatabaseConnectionsCurrentlySessionPinned", ".", ".", { label = "pinned", color = "#d62728" }],
    ] } },
    { type = "metric", x = 16, y = 8, width = 8, height = 6, properties = {
      title = "RDS CPU and connections", region = var.region, period = 60, view = "timeSeries",
      metrics = [
        ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.identifier, { stat = "Average", label = "CPU %" }],
        [".", "DatabaseConnections", ".", ".", { stat = "Maximum", label = "connections", yAxis = "right" }],
    ] } },
    { type = "metric", x = 0, y = 14, width = 8, height = 6, properties = {
      title = "Redis memory, CPU and evictions", region = var.region, period = 60, view = "timeSeries",
      metrics = [
        ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "CacheClusterId", local.redis_id, { stat = "Maximum", label = "memory %" }],
        [".", "EngineCPUUtilization", ".", ".", { stat = "Average", label = "engine CPU %" }],
        [".", "Evictions", ".", ".", { stat = "Sum", label = "evictions", yAxis = "right", color = "#d62728" }],
    ] } },
    { type = "metric", x = 8, y = 14, width = 8, height = 6, properties = {
      title = "Mail queue and dead-letter queue", region = var.region, stat = "Maximum", period = 60, view = "timeSeries",
      metrics = [
        ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.mail_queue_name, { label = "waiting" }],
        [".", "ApproximateAgeOfOldestMessage", ".", ".", { label = "oldest (s)", yAxis = "right" }],
        [".", "ApproximateNumberOfMessagesVisible", ".", var.mail_dlq_name, { label = "dead-letter", color = "#d62728" }],
    ] } },
    { type = "metric", x = 16, y = 14, width = 8, height = 6, properties = {
      title = "Edge node group CPU", region = var.region, stat = "Average", period = 60, view = "timeSeries",
      metrics = [
        ["AWS/EC2", "CPUUtilization", "AutoScalingGroupName", local.edge_autoscaling_group, { label = "edge nodes" }],
    ] } },
    { type = "alarm", x = 0, y = 20, width = 24, height = 4, properties = {
      title  = "Alarms",
      alarms = concat([for a in aws_cloudwatch_metric_alarm.this : a.arn], [aws_cloudwatch_metric_alarm.waf_blocks.arn]),
    } },
  ]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = var.project
  dashboard_body = jsonencode({ widgets = [for w in local.dashboard_widgets : merge({ x = w.x, y = w.y, width = w.width, height = w.height, type = w.type }, { properties = w.properties })] })
}
