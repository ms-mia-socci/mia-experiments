resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.poc.id
  cidr_block        = "10.85.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
}
resource "aws_eip" "nat" { domain = "vpc" }
resource "aws_nat_gateway" "agent" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.poc]
}
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.poc.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.agent.id
  }
}
resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.poc.id
  service_name      = "com.amazonaws.us-east-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id, aws_route_table.public.id]
}
resource "aws_security_group" "agent" {
  name   = "${local.name}-agent"
  vpc_id = aws_vpc.poc.id
}
resource "aws_security_group" "database" {
  name   = "${local.name}-database"
  vpc_id = aws_vpc.poc.id
}
resource "aws_vpc_security_group_egress_rule" "agent_https" {
  security_group_id = aws_security_group.agent.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
resource "aws_vpc_security_group_ingress_rule" "database" {
  for_each                     = { web = aws_security_group.web.id, agent = aws_security_group.agent.id }
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
resource "aws_vpc_security_group_egress_rule" "database" {
  for_each                     = { web = aws_security_group.web.id, agent = aws_security_group.agent.id }
  security_group_id            = each.value
  referenced_security_group_id = aws_security_group.database.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
resource "aws_db_subnet_group" "fieldwork" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}
resource "aws_db_instance" "fieldwork" {
  identifier                  = local.name
  engine                      = "postgres"
  engine_version              = "17"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "fieldwork"
  username                    = "fieldwork"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.fieldwork.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  publicly_accessible         = false
  backup_retention_period     = 7
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "fieldwork-router-lab-final"
  auto_minor_version_upgrade  = true
}
