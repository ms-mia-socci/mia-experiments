data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "viewer" { name = "Managed-AllViewer" }
data "aws_availability_zones" "available" {
  state = "available"
  filter {
    name   = "zone-id"
    values = ["use1-az1", "use1-az2", "use1-az4"]
  }
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}


resource "random_password" "origin" {
  length  = 40
  special = false
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}"
  retention_in_days = 30
}

resource "aws_vpc" "poc" {
  cidr_block           = "10.85.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}

resource "aws_internet_gateway" "poc" {
  vpc_id = aws_vpc.poc.id
}

resource "aws_subnet" "public" {

  count                   = 2
  vpc_id                  = aws_vpc.poc.id
  cidr_block              = "10.85.${count.index}.0/24"
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
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"

}

resource "aws_vpc_security_group_ingress_rule" "web" {

  security_group_id            = aws_security_group.web.id
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 8080
  to_port                      = 8080
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
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.poc.id
  health_check {
    path              = "/ping"
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
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.viewer.id
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
  domain       = "${local.name}-${local.account_id}"
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
  callback_urls                        = ["https://${aws_cloudfront_distribution.web.domain_name}/auth/callback"]
  logout_urls                          = ["https://${aws_cloudfront_distribution.web.domain_name}/"]
  prevent_user_existence_errors        = "ENABLED"
  explicit_auth_flows                  = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  id_token_validity                    = 1
  access_token_validity                = 1

}

resource "aws_ecs_cluster" "web" {
  name = local.name
}
