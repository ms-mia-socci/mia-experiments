variable "image_tag" {
  type        = string
  description = "Immutable image tag already pushed to both bootstrap ECR repositories"
}
data "aws_ecr_repository" "images" {
  for_each = toset(["web", "agent"])
  name     = "${local.name}/${each.key}"
}
data "aws_ecr_image" "images" {
  for_each        = toset(["web", "agent"])
  repository_name = data.aws_ecr_repository.images[each.key].name
  image_tag       = var.image_tag
}
data "aws_secretsmanager_secret" "models" { name = "${local.name}/model-credentials" }
locals {
  common_environment = {
    AWS_REGION                    = local.region
    FIELDWORK_DATABASE_HOST       = aws_db_instance.fieldwork.address
    FIELDWORK_DATABASE_SECRET_ARN = aws_db_instance.fieldwork.master_user_secret[0].secret_arn
    FIELDWORK_MEMORY_ID           = aws_bedrockagentcore_memory.fieldwork.id
    FIELDWORK_ARTIFACT_BUCKET     = aws_s3_bucket.artifacts.id
  }
}
resource "aws_iam_role" "agent" {
  name = "${local.name}-agent"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Action = "sts:AssumeRole", Principal = { Service = "bedrock-agentcore.amazonaws.com" },
    Condition = { StringEquals = { "aws:SourceAccount" = local.account_id }, ArnLike = { "aws:SourceArn" = "arn:aws:bedrock-agentcore:${local.region}:${local.account_id}:*" } }
  }] })
}
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" } }] })
}
resource "aws_iam_role" "web" {
  name               = "${local.name}-web"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "storage" {
  for_each = { web = aws_iam_role.web.id, agent = aws_iam_role.agent.id }
  role     = each.value
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_db_instance.fieldwork.master_user_secret[0].secret_arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.artifacts.arn}/workspaces/*" },
    { Effect = "Allow", Action = ["bedrock-agentcore:CreateEvent", "bedrock-agentcore:RetrieveMemoryRecords", "bedrock-agentcore:ListMemoryRecords", "bedrock-agentcore:DeleteMemoryRecord", "bedrock-agentcore:ListEvents", "bedrock-agentcore:DeleteEvent"], Resource = [aws_bedrockagentcore_memory.fieldwork.arn, "${aws_bedrockagentcore_memory.fieldwork.arn}/*"] }
  ] })
}
resource "aws_iam_role_policy" "agent" {
  role = aws_iam_role.agent.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = data.aws_secretsmanager_secret.models.arn },
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], Resource = data.aws_ecr_repository.images["agent"].arn },
    { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:DescribeLogStreams"], Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/fieldwork_router_lab-*" },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/fieldwork_router_lab-*:log-stream:*" },
    { Effect = "Allow", Action = ["logs:PutResourcePolicy"], Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/fieldwork_router_lab-*" },
    { Effect = "Allow", Action = ["logs:DescribeLogGroups"], Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:*" },
    { Effect = "Allow", Action = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"], Resource = "*" },
    { Effect = "Allow", Action = ["cloudwatch:PutMetricData"], Resource = "*", Condition = { StringEquals = { "cloudwatch:namespace" = "bedrock-agentcore" } } },
    { Effect = "Allow", Action = ["bedrock-agentcore:StartCodeInterpreterSession", "bedrock-agentcore:InvokeCodeInterpreter", "bedrock-agentcore:StopCodeInterpreterSession"], Resource = "arn:aws:bedrock-agentcore:${local.region}:aws:code-interpreter/aws.codeinterpreter.v1" },
  ] })
}
resource "aws_bedrockagentcore_agent_runtime" "fieldwork" {
  agent_runtime_name = "fieldwork_router_lab"
  description        = "Fieldwork: Strands, Claude Agent SDK and Codex over AG-UI"
  role_arn           = aws_iam_role.agent.arn
  agent_runtime_artifact {
    container_configuration { container_uri = "${data.aws_ecr_repository.images["agent"].repository_url}@${data.aws_ecr_image.images["agent"].image_digest}" }
  }
  network_configuration {
    network_mode = "VPC"
    network_mode_config {
      security_groups = [aws_security_group.agent.id]
      subnets         = aws_subnet.private[*].id
    }
  }
  protocol_configuration { server_protocol = "AGUI" }
  lifecycle_configuration {
    idle_runtime_session_timeout = 60
    max_lifetime                 = 900
  }
  environment_variables = merge(local.common_environment, {
    FIELDWORK_SERVICE                                  = "agent"
    FIELDWORK_MODEL_SECRET_ARN                         = data.aws_secretsmanager_secret.models.arn
    AGENT_OBSERVABILITY_ENABLED                        = "true"
    UNIFIED_TRACES_DESTINATION_ENABLED                 = "true"
    OTEL_EXPORTER_OTLP_PROTOCOL                        = "http/protobuf"
    OTEL_LOGS_EXPORTER                                 = "none"
    OTEL_LOG_LEVEL                                     = "error"
    OTEL_TRACES_EXPORTER                               = "otlp"
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = "false"
    OTEL_NODE_ENABLED_INSTRUMENTATIONS                 = "aws-sdk,http,undici"
    OTEL_RESOURCE_ATTRIBUTES                           = "service.name=fieldwork-router-lab-agent,deployment.environment=poc,fieldwork.telemetry.content_capture=false"
  })
  depends_on = [aws_iam_role_policy.agent, aws_iam_role_policy.storage, aws_route_table_association.private, aws_vpc_endpoint.s3]
}
resource "aws_iam_role_policy" "invoke" {
  role = aws_iam_role.web.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["bedrock-agentcore:InvokeAgentRuntime"], Resource = [aws_bedrockagentcore_agent_runtime.fieldwork.agent_runtime_arn, "${aws_bedrockagentcore_agent_runtime.fieldwork.agent_runtime_arn}/*"]
  }] })
}
resource "aws_ecs_task_definition" "web" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
  container_definitions = jsonencode([{
    name         = "web", image = "${data.aws_ecr_repository.images["web"].repository_url}@${data.aws_ecr_image.images["web"].image_digest}", essential = true,
    portMappings = [{ containerPort = 8080, protocol = "tcp" }],
    environment = [for k, v in merge(local.common_environment, {
      FIELDWORK_SERVICE        = "web"
      ORIGIN                   = "https://${aws_cloudfront_distribution.web.domain_name}"
      FIELDWORK_RUNTIME_ARN    = aws_bedrockagentcore_agent_runtime.fieldwork.agent_runtime_arn
      FIELDWORK_OIDC_ISSUER    = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
      FIELDWORK_OIDC_CLIENT_ID = aws_cognito_user_pool_client.web.id
      FIELDWORK_OIDC_DOMAIN    = "https://${aws_cognito_user_pool_domain.users.domain}.auth.${local.region}.amazoncognito.com"
    }) : { name = k, value = v }],
    logConfiguration = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.web.name, awslogs-region = local.region, awslogs-stream-prefix = "web" } }
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
    container_port   = 8080
  }
  depends_on = [aws_lb_listener_rule.cloudfront, aws_iam_role_policy.invoke, aws_iam_role_policy.storage, aws_iam_role_policy_attachment.execution]
}
output "url" { value = "https://${aws_cloudfront_distribution.web.domain_name}" }
output "runtime_arn" { value = aws_bedrockagentcore_agent_runtime.fieldwork.agent_runtime_arn }
output "memory_id" { value = aws_bedrockagentcore_memory.fieldwork.id }
output "user_pool_id" { value = aws_cognito_user_pool.users.id }
output "artifact_bucket" { value = aws_s3_bucket.artifacts.id }
