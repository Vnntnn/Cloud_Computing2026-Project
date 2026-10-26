# The production network: a dedicated VPC instead of the lab's default one
# (supersedes "no VPC module" in the knowledge-base decision log, 2026-10-25).
# Everything here is free while idle, so it is permanent: `make down` keeps it, and
# only the billable pieces (NAT gateway, interface endpoints, EKS, RDS ...) live in
# modules/platform. Single-AZ as drawn (us-east-1a). The 1b subnets exist only
# because the EKS control plane, the RDS subnet group and the ALB each demand two AZs.
#
#   public    1a NAT gateway · 1b ALB only
#   edge      1a private, NO default route: ingress-nginx, event, registration, web
#   egress    1a private, default route -> NAT: auth, payment, mail-worker
#   data      1a RDS / ElastiCache; 1b subnet-group minimum only (no instances)
#   cp        1b private, EKS control-plane ENIs only (second AZ)
locals {
  vpc_cidr = "10.20.0.0/16"
  az_a     = var.availability_zones[0]
  az_b     = var.availability_zones[1]

  subnets = {
    public_a = { cidr = "10.20.0.0/24", az = local.az_a, table = "public" }
    public_b = { cidr = "10.20.1.0/24", az = local.az_b, table = "public" }
    edge_a   = { cidr = "10.20.10.0/24", az = local.az_a, table = "edge" }
    egress_a = { cidr = "10.20.20.0/24", az = local.az_a, table = "egress" }
    data_a   = { cidr = "10.20.30.0/24", az = local.az_a, table = "data" }
    data_b   = { cidr = "10.20.31.0/24", az = local.az_b, table = "data" }
    cp_b     = { cidr = "10.20.40.0/24", az = local.az_b, table = "edge" }
  }
}

resource "aws_vpc" "main" {
  cidr_block           = local.vpc_cidr
  enable_dns_support   = true # interface endpoints' private DNS needs both
  enable_dns_hostnames = true
  tags                 = { Name = var.project }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = var.project }
}

resource "aws_subnet" "this" {
  for_each = local.subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.cidr
  availability_zone = each.value.az
  tags              = { Name = "${var.project}-${replace(each.key, "_", "-")}" }
}

resource "aws_route_table" "this" {
  for_each = toset(["public", "edge", "egress", "data"])

  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-${each.key}" }
}

# Only the public table has its default route here. The egress table's route to the
# NAT gateway is added by modules/platform (the NAT bills hourly); edge and data never get one.
resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.this["public"].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "this" {
  for_each = local.subnets

  subnet_id      = aws_subnet.this[each.key].id
  route_table_id = aws_route_table.this[each.value.table].id
}

# S3 over the AWS network (free): event images, and the ECR image layers the edge nodes pull.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for t in ["edge", "egress", "data"] : aws_route_table.this[t].id]
  tags              = { Name = "${var.project}-s3" }
}
