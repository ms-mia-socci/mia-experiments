resource "aws_s3_bucket" "artifacts" {
  bucket = "${local.name}-${local.account_id}-artifacts"
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
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "tls" {
  bucket = aws_s3_bucket.artifacts.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
resource "aws_bedrockagentcore_memory" "fieldwork" {
  name                  = "fieldwork_router_memory"
  description           = "Opt-in Fieldwork POC memory in Medplum"
  event_expiry_duration = 7
}
resource "aws_bedrockagentcore_memory_strategy" "preferences" {
  memory_id           = aws_bedrockagentcore_memory.fieldwork.id
  name                = "FieldworkPreferences"
  type                = "USER_PREFERENCE"
  namespace_templates = ["/preferences/{actorId}/"]
}
resource "aws_bedrockagentcore_memory_strategy" "summaries" {
  memory_id           = aws_bedrockagentcore_memory.fieldwork.id
  name                = "FieldworkSummaries"
  type                = "SUMMARIZATION"
  namespace_templates = ["/summaries/{actorId}/{sessionId}/"]
}
