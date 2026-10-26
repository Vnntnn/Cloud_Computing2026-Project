# The only way out of the egress tier. Billed hourly (~$0.045/h + data), which is why
# it lives here and not with the free network at the root: `make down` removes it.
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project}-nat" }
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = var.public_subnet_ids[0]
  tags          = { Name = var.project }
}

resource "aws_route" "egress_default" {
  route_table_id         = var.egress_route_table_id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this.id
}
