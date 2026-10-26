# The edge tier has no route to the internet, so what a node and its pods need from AWS
# goes through the VPC instead: ECR (api + dkr) for images, STS for the node's IAM
# auth, EC2 for the CNI's ENI/IP calls, SQS for registration's mail queue, Secrets Manager for RDS Proxy (it has no other way to read the credentials). The S3 gateway
# endpoint (free, network.tf) carries the ECR layers and event images. Interface endpoints
# bill hourly per AZ, so they live here and one subnet is enough (single-AZ).
resource "aws_security_group" "endpoints" {
  name        = "${var.project}-endpoints"
  description = "HTTPS to the interface endpoints from inside the VPC"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS from the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(["ecr.api", "ecr.dkr", "sts", "ec2", "sqs", "secretsmanager"])

  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [var.edge_subnet_id]
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
  tags                = { Name = "${var.project}-${replace(each.key, ".", "-")}" }
}
