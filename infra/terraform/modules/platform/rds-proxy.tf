# RDS Proxy in front of the database: the apps connect to the proxy, which multiplexes
# their pools (DB_POOL_MAX x pods) onto a few real connections, so the HPA can add pods
# without exhausting db.t3.micro's ~87. Migrations skip it (DATABASE_MIGRATE_URL): a
# schema change is better off on a plain session. The proxy reads the credentials from the
# same secret as everything else (eventide/rds-master: username + password, extra keys ignored).
#
# iam:CreateRole is denied, so the proxy role is the lab's LabRole (it trusts
# rds.amazonaws.com and may read Secrets Manager: probed 2026-10-25).
data "aws_iam_roles" "lab_role" {
  name_regex = "^LabRole$"
}

resource "aws_security_group" "proxy" {
  name        = "${var.project}-rds-proxy"
  description = "RDS Proxy: PostgreSQL from the EKS nodes, out to RDS"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [local.node_security_group_id]
  }

  # the VPC CIDR, not the RDS group: RDS already references this group, and two groups can't reference each other in Terraform
  egress {
    description = "PostgreSQL to RDS"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_db_proxy" "main" {
  name                = var.project
  engine_family       = "POSTGRESQL"
  role_arn            = one(data.aws_iam_roles.lab_role.arns)
  require_tls         = true
  idle_client_timeout = 1800

  vpc_subnet_ids         = var.data_subnet_ids
  vpc_security_group_ids = [aws_security_group.proxy.id]

  auth {
    auth_scheme               = "SECRETS"
    iam_auth                  = "DISABLED"
    client_password_auth_type = "POSTGRES_SCRAM_SHA_256"
    secret_arn                = aws_secretsmanager_secret.db_master.arn
  }

  depends_on = [aws_secretsmanager_secret_version.db_master, aws_vpc_endpoint.interface]
}

resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name

  connection_pool_config {
    max_connections_percent      = 90
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 30
  }
}

resource "aws_db_proxy_target" "main" {
  db_proxy_name          = aws_db_proxy.main.name
  target_group_name      = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = aws_db_instance.main.identifier
}

# What the pods connect to. The proxy URL and the Redis URL carry credentials, so they
# live in Secrets Manager like the rest; scripts/deploy.sh copies them into eventide-common.
resource "aws_secretsmanager_secret" "endpoints" {
  name                    = "${var.project}/endpoints"
  description             = "DATABASE_URL (via RDS Proxy), DATABASE_MIGRATE_URL (direct to RDS), REDIS_URL. Consumed by scripts/deploy.sh."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "endpoints" {
  secret_id = aws_secretsmanager_secret.endpoints.id
  secret_string = jsonencode({
    DATABASE_URL         = "postgres://${aws_db_instance.main.username}:${random_password.db_master.result}@${aws_db_proxy.main.endpoint}:5432/${aws_db_instance.main.db_name}?sslmode=require"
    DATABASE_MIGRATE_URL = "postgres://${aws_db_instance.main.username}:${random_password.db_master.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}?sslmode=require"
    REDIS_URL            = "rediss://:${random_password.redis_auth.result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
  })
}
