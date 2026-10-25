# One db.t3.micro, ONE database (`eventide`, created by RDS via db_name) and one
# role: the v2 schema is a single Drizzle schema with cross-table foreign keys
# (events.organizer_id -> users.id), so there is nothing to split. Migrations run
# in-cluster as the chart's db-migrate hook Job connecting as this master user —
# NOT by Terraform's postgresql provider, which would need network reachability
# to RDS from a laptop (SYSTEM-DESIGN.md §7.1). ponytail: one role; split per
# service only if the rubric asks for least privilege.

resource "random_password" "db_master" {
  length  = 24
  special = false # keep it URL-safe for DATABASE_URL
}

# Better Auth's secret (session signing, >= 32 chars). Regenerated on every
# rebuild — the database is recreated too, so no session outlives it. Carried in
# the rds-master secret (scripts/deploy.sh reads it into the eventide-auth k8s Secret).
resource "random_password" "better_auth" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = var.data_subnet_ids
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "RDS PostgreSQL reachable only from the EKS node security group"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from EKS nodes (the migrate Job connects direct)"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [local.node_security_group_id]
  }

  ingress {
    description     = "PostgreSQL from RDS Proxy"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.proxy.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "main" {
  identifier     = var.project
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true # AWS-managed aws/rds key — no CMK needed

  # Changing db_name forces replacement — irrelevant here, the instance is
  # destroyed every session anyway.
  db_name  = var.project
  username = "eventide_master"
  password = random_password.db_master.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  # Nightly destroy + reseed — no backups, no snapshot, no protection, or the
  # destroy fails (PROJECT-KNOWLEDGE-BASE.md §4).
  backup_retention_period    = 0
  skip_final_snapshot        = true
  deletion_protection        = false
  delete_automated_backups   = true
  apply_immediately          = true
  auto_minor_version_upgrade = true

  performance_insights_enabled = false
}

# Master credentials + endpoint: DATABASE_URL for every service and the migrate
# Job (scripts/deploy.sh → the eventide-common k8s Secret). Lives in the platform module
# (recreated each rebuild with a fresh password) — recovery_window_in_days = 0 so
# the name frees immediately.
resource "aws_secretsmanager_secret" "db_master" {
  name                    = "${var.project}/rds-master"
  description             = "RDS master credentials + endpoint + BETTER_AUTH_SECRET. Consumed by scripts/deploy.sh."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db_master" {
  secret_id = aws_secretsmanager_secret.db_master.id
  secret_string = jsonencode({
    username = aws_db_instance.main.username
    password = random_password.db_master.result
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
    # Ready-to-use for every pod (packages/db reads DATABASE_URL; the migrate Job too).
    # `?sslmode=require` — RDS PG16's default parameter group sets rds.force_ssl=1,
    # so a plain connection is rejected ("no pg_hba.conf entry ... no encryption").
    # `require` = encrypt, don't verify the cert (fine inside the VPC).
    DATABASE_URL       = "postgres://${aws_db_instance.main.username}:${random_password.db_master.result}@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}?sslmode=require"
    BETTER_AUTH_SECRET = random_password.better_auth.result
  })
}
