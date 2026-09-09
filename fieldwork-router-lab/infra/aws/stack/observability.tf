resource "aws_cloudwatch_log_resource_policy" "transaction_search" {
  policy_name = "${local.name}-transaction-search"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TransactionSearchXRayAccess"
      Effect    = "Allow"
      Principal = { Service = "xray.amazonaws.com" }
      Action    = "logs:PutLogEvents"
      Resource = [
        "arn:aws:logs:${local.region}:${local.account_id}:log-group:aws/spans:*",
        "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/application-signals/data:*"
      ]
      Condition = {
        ArnLike      = { "aws:SourceArn" = "arn:aws:xray:${local.region}:${local.account_id}:*" }
        StringEquals = { "aws:SourceAccount" = local.account_id }
      }
    }]
  })
}

resource "aws_xray_trace_segment_destination" "transaction_search" {
  destination = "CloudWatchLogs"
  depends_on  = [aws_cloudwatch_log_resource_policy.transaction_search]
}

resource "aws_xray_indexing_rule" "default" {
  name = "Default"
  rule {
    probabilistic {
      # AWS includes the first 1% in Transaction Search without added indexing cost.
      desired_sampling_percentage = 1
    }
  }
  depends_on = [aws_xray_trace_segment_destination.transaction_search]
}

resource "aws_cloudwatch_log_group" "agent_runtime" {
  name              = "/aws/bedrock-agentcore/runtimes/${aws_bedrockagentcore_agent_runtime.fieldwork.agent_runtime_id}-DEFAULT"
  retention_in_days = 30
}
