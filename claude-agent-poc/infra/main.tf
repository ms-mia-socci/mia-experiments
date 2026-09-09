terraform {

  required_version = ">= 1.10"
  required_providers {

    aws = {
      source = "hashicorp/aws", version = "~> 6.0"
    }
    random = {
      source = "hashicorp/random", version = "~> 3.0"
    }

  }

}
provider "aws" {

  region = "us-east-1"
  default_tags {
    tags = {
      Project = "claude-agent-poc", ManagedBy = "terraform"
    }
  }

}
variable "image_tag" {
  type = string
}
variable "claude_model" {
  type    = string
  default = "claude-sonnet-4-6"
}
data "aws_caller_identity" "current" {

}
data "aws_availability_zones" "available" {
  state = "available"
}
data "aws_ecr_repository" "agent" {
  name = "claude-agent-poc/agent"
}
data "aws_ecr_repository" "web" {
  name = "claude-agent-poc/web"
}
data "aws_secretsmanager_secret" "anthropic" {
  name = "claude-agent-poc/anthropic-api-key"
}
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
locals {

  name    = "claude-agent-poc"
  account = data.aws_caller_identity.current.account_id

}
resource "random_password" "origin" {
  length  = 40
  special = false
}
resource "aws_dynamodb_table" "sessions" {

  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled = true
  }

}
resource "aws_s3_bucket" "artifacts" {
  bucket = "${local.name}-${local.account}-artifacts"
}
resource "aws_s3_bucket_public_access_block" "artifacts" {

  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

}
resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {

  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }

}
resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {

  bucket = aws_s3_bucket.artifacts.id
  rule {
    id     = "poc-retention"
    status = "Enabled"
    filter {

    }
    expiration {
      days = 7
    }
  }

}
resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}"
  retention_in_days = 7
}
resource "aws_iam_role" "agent" {

  name = "${local.name}-agent"
  assume_role_policy = jsonencode({
    Version = "2012-10-17", Statement = [{
      Effect = "Allow", Principal = {
        Service = "bedrock-agentcore.amazonaws.com"
        }, Action = "sts:AssumeRole", Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account
          }, ArnLike = {
          "aws:SourceArn" = "arn:aws:bedrock-agentcore:us-east-1:${local.account}:*"
        }
      }
    }]
  })

}
resource "aws_iam_role_policy" "agent" {

  role = aws_iam_role.agent.id
  policy = jsonencode({
    Version = "2012-10-17", Statement = [
      {
        Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*"
      },
      {
        Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], Resource = data.aws_ecr_repository.agent.arn
      },
      {
        Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = data.aws_secretsmanager_secret.anthropic.arn
      },
      {
        Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"], Resource = aws_dynamodb_table.sessions.arn
      },
      {
        Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.artifacts.arn}/*"
      },
      {
        Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource = "arn:aws:logs:us-east-1:${local.account}:log-group:/aws/bedrock-agentcore/runtimes/*"
      },
      {
        Effect = "Allow", Action = ["logs:DescribeLogGroups"], Resource = "arn:aws:logs:us-east-1:${local.account}:log-group:*"
      }
    ]
  })

}
resource "aws_bedrockagentcore_agent_runtime" "agent" {

  agent_runtime_name = "claude_agent_poc"
  description        = "Managed Claude Agent SDK with AG-UI and approved workspace tools"
  role_arn           = aws_iam_role.agent.arn
  agent_runtime_artifact {
    container_configuration {
      container_uri = "${data.aws_ecr_repository.agent.repository_url}:${var.image_tag}"
    }
  }
  network_configuration {
    network_mode = "PUBLIC"
  }
  protocol_configuration {
    server_protocol = "AGUI"
  }
  lifecycle_configuration {
    idle_runtime_session_timeout = 900
    max_lifetime                 = 3600
  }
  environment_variables = {

    ANTHROPIC_SECRET_ARN = data.aws_secretsmanager_secret.anthropic.arn
    SESSION_TABLE        = aws_dynamodb_table.sessions.name
    ARTIFACT_BUCKET      = aws_s3_bucket.artifacts.id
    CLAUDE_MODEL         = var.claude_model
    AWS_REGION           = "us-east-1"

  }
  depends_on = [aws_iam_role_policy.agent]

}
resource "aws_vpc" "poc" {
  cidr_block           = "10.84.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}
resource "aws_internet_gateway" "poc" {
  vpc_id = aws_vpc.poc.id
}
resource "aws_subnet" "public" {

  count                   = 2
  vpc_id                  = aws_vpc.poc.id
  cidr_block              = "10.84.${count.index}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

}
resource "aws_route_table" "public" {

  vpc_id = aws_vpc.poc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.poc.id
  }

}
resource "aws_route_table_association" "public" {

  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id

}
resource "aws_security_group" "alb" {
  name   = "${local.name}-alb"
  vpc_id = aws_vpc.poc.id
}
resource "aws_security_group" "web" {
  name   = "${local.name}-web"
  vpc_id = aws_vpc.poc.id
}
resource "aws_vpc_security_group_ingress_rule" "cloudfront" {

  security_group_id = aws_security_group.alb.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"

}
resource "aws_vpc_security_group_egress_rule" "alb" {

  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.web.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"

}
resource "aws_vpc_security_group_ingress_rule" "web" {

  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"

}
resource "aws_vpc_security_group_egress_rule" "web" {

  security_group_id = aws_security_group.web.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"

}
resource "aws_lb" "web" {

  name               = local.name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  idle_timeout       = 300

}
resource "aws_lb_target_group" "web" {

  name        = local.name
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.poc.id
  health_check {
    path              = "/health"
    matcher           = "200"
    interval          = 15
    healthy_threshold = 2
  }
  deregistration_delay = 10

}
resource "aws_lb_listener" "web" {

  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      status_code  = "403"
      message_body = "Forbidden"
    }
  }

}
resource "aws_lb_listener_rule" "cloudfront" {

  listener_arn = aws_lb_listener.web.arn
  priority     = 1
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
  condition {
    http_header {
      http_header_name = "X-Poc-Origin"
      values           = [random_password.origin.result]
    }
  }

}
resource "aws_cloudfront_distribution" "web" {

  enabled     = true
  comment     = local.name
  price_class = "PriceClass_100"
  origin {

    domain_name = aws_lb.web.dns_name
    origin_id   = "web"
    custom_header {
      name  = "X-Poc-Origin"
      value = random_password.origin.result
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }

  }
  default_cache_behavior {

    target_origin_id         = "web"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "413f160d-6f6d-4c0b-a679-9c8c2dc21b21"
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3"
    compress                 = false

  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }

}
resource "aws_cognito_user_pool" "users" {

  name = local.name
  admin_create_user_config {
    allow_admin_create_user_only = true
  }
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  password_policy {
    minimum_length    = 14
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = "1"
      max_length = "2048"
    }
  }

}
resource "aws_cognito_user_pool_domain" "users" {
  domain       = "${local.name}-${local.account}"
  user_pool_id = aws_cognito_user_pool.users.id
}
resource "aws_cognito_user_pool_client" "web" {

  name                                 = "web"
  user_pool_id                         = aws_cognito_user_pool.users.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${aws_cloudfront_distribution.web.domain_name}/auth/callback", "http://localhost:5173/auth/callback"]
  logout_urls                          = ["https://${aws_cloudfront_distribution.web.domain_name}/", "http://localhost:5173/"]
  prevent_user_existence_errors        = "ENABLED"
  explicit_auth_flows                  = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  id_token_validity                    = 1
  access_token_validity                = 1

}
resource "aws_ecs_cluster" "web" {
  name = local.name
}
resource "aws_iam_role" "execution" {

  name = "${local.name}-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17", Statement = [{
      Effect = "Allow", Action = "sts:AssumeRole", Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

}
resource "aws_iam_role_policy_attachment" "execution" {

  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"

}
resource "aws_iam_role" "web" {

  name               = "${local.name}-web"
  assume_role_policy = aws_iam_role.execution.assume_role_policy

}
resource "aws_iam_role_policy" "web" {

  role = aws_iam_role.web.id
  policy = jsonencode({
    Version = "2012-10-17", Statement = [
      {
        Effect = "Allow", Action = ["bedrock-agentcore:InvokeAgentRuntime"], Resource = [aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn, "${aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn}/*"]
      },
      {
        Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:TransactWriteItems"], Resource = aws_dynamodb_table.sessions.arn
      },
      {
        Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.artifacts.arn}/*"
      }
    ]
  })

}
resource "aws_ecs_task_definition" "web" {

  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
  container_definitions = jsonencode([{

    name = "web", image = "${data.aws_ecr_repository.web.repository_url}:${var.image_tag}", essential = true,
    portMappings = [{
      containerPort = 3000, protocol = "tcp"
    }],
    environment = [for k, v in {

      NODE_ENV             = "production", PORT = "3000", HOST = "0.0.0.0", ORIGIN = "https://${aws_cloudfront_distribution.web.domain_name}",
      AWS_REGION           = "us-east-1", SESSION_TABLE = aws_dynamodb_table.sessions.name, ARTIFACT_BUCKET = aws_s3_bucket.artifacts.id,
      AGENT_RUNTIME_ARN    = aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn,
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.users.id, COGNITO_CLIENT_ID = aws_cognito_user_pool_client.web.id,
      COGNITO_DOMAIN       = "https://${aws_cognito_user_pool_domain.users.domain}.auth.us-east-1.amazoncognito.com"

      } : {
      name = k, value = v
    }],
    logConfiguration = {
      logDriver = "awslogs", options = {
        awslogs-group = aws_cloudwatch_log_group.web.name, awslogs-region = "us-east-1", awslogs-stream-prefix = "web"
      }
    }

  }])

}
resource "aws_ecs_service" "web" {

  name                  = local.name
  cluster               = aws_ecs_cluster.web.id
  task_definition       = aws_ecs_task_definition.web.arn
  desired_count         = 1
  launch_type           = "FARGATE"
  wait_for_steady_state = true
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener_rule.cloudfront, aws_iam_role_policy.web, aws_iam_role_policy_attachment.execution]

}
output "url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}"
}
output "runtime_arn" {
  value = aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn
}
output "user_pool_id" {
  value = aws_cognito_user_pool.users.id
}
output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}
output "cognito_domain" {
  value = "https://${aws_cognito_user_pool_domain.users.domain}.auth.us-east-1.amazoncognito.com"
}
output "session_table" {
  value = aws_dynamodb_table.sessions.name
}
output "artifact_bucket" {
  value = aws_s3_bucket.artifacts.id
}
