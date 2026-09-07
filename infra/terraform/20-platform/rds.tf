# One db.t3.micro. The three service databases (auth_db / event_db /
# registration_db) and their owners are created in-cluster by a Kubernetes Job
# connecting as this master user — NOT by Terraform's postgresql provider, which
# would need network reachability to RDS from a laptop (SYSTEM-DESIGN.md §7.1).

resource "random_password" "db_master" {
  length  = 24
  special = false # keep it URL-safe for DATABASE_URL
}

# Per-service role passwords. The db-bootstrap Job CREATE ROLEs with these; the
# services' DATABASE_URLs (assembled by scripts/deploy.sh from this same secret)
# use the same values. All regenerated on every rebuild, alongside the master password.
resource "random_password" "svc" {
  for_each = toset(["auth_svc", "event_svc", "registration_svc"])
  length   = 20
  special  = false
}

# Key-encryption key for better-auth's JWKS private keys. better-auth requires
# >= 32 chars. Regenerated on every rebuild — auth_db is recreated too, so the
# jwks row is always fresh. Carried in the rds-master secret (scripts/deploy.sh
# reads it into the eventide-auth k8s Secret).
resource "random_password" "better_auth" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = data.aws_subnets.abc.ids
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "RDS PostgreSQL reachable only from the EKS node security group"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "PostgreSQL from EKS nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [local.node_security_group_id]
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

# Master credentials + endpoint, for the DB-bootstrap Job and for assembling each
# service's DATABASE_URL. Lives in 20-platform (recreated each rebuild with a
# fresh password) — recovery_window_in_days = 0 so the name frees immediately.
resource "aws_secretsmanager_secret" "db_master" {
  name                    = "${var.project}/rds-master"
  description             = "RDS master credentials + endpoint. Consumed by the DB-bootstrap Job."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db_master" {
  secret_id = aws_secretsmanager_secret.db_master.id
  secret_string = jsonencode(merge(
    {
      username = aws_db_instance.main.username
      password = random_password.db_master.result
      host     = aws_db_instance.main.address
      port     = aws_db_instance.main.port
      dbname   = "postgres"
      # Ready-to-use for the db-bootstrap Job's env (scripts/bootstrap.ts).
      # `?sslmode=require` — RDS PG16's default parameter group sets rds.force_ssl=1,
      # so a plain connection is rejected ("no pg_hba.conf entry ... no encryption").
      # `require` = encrypt, don't verify the cert (fine inside the VPC).
      MASTER_DATABASE_URL = "postgres://${aws_db_instance.main.username}:${random_password.db_master.result}@${aws_db_instance.main.endpoint}/postgres?sslmode=require"
      BETTER_AUTH_SECRET  = random_password.better_auth.result
    },
    # AUTH_SVC_PASSWORD / EVENT_SVC_PASSWORD / REGISTRATION_SVC_PASSWORD
    { for k, v in random_password.svc : "${upper(k)}_PASSWORD" => v.result },
  ))
}
