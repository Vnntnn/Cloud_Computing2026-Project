# Redis for @app/auth-guard's 60 s session cache, the event-detail cache and the
# `seats:changed` pub/sub (replaces the in-cluster `redis` pod, 2026-10-25). One node in
# the data subnet: it only ever holds cache entries and messages, so losing it costs one
# slow request, never a wrong one. A replication group (not an `aws_elasticache_cluster`)
# because only that resource offers in-transit TLS + an AUTH token. The apps need no
# change: Bun's Redis client reads REDIS_URL and speaks `rediss://`.

# AUTH tokens allow 16-128 printable characters, no `@ " /`: alphanumeric keeps the URL safe too.
resource "random_password" "redis_auth" {
  length  = 40
  special = false
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project}-redis"
  subnet_ids = var.data_subnet_ids
}

resource "aws_security_group" "redis" {
  name        = "${var.project}-redis"
  description = "Redis reachable only from the EKS node security group"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis (TLS) from EKS nodes"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [local.node_security_group_id]
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = var.project
  description          = "Eventide session + event cache and seat pub/sub"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_clusters   = 1 # single-AZ, as drawn
  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  automatic_failover_enabled = false
  snapshot_retention_limit   = 0 # a cache: nothing to restore
  apply_immediately          = true
}
