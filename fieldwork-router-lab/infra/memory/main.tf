terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.62" }
  }
}
provider "aws" {
  profile = "ai"
  region  = "us-east-1"
}
resource "aws_bedrockagentcore_memory" "fieldwork" {
  name                  = "fieldwork_router_memory"
  description           = "Opt-in memory for the local Fieldwork multi-framework lab"
  event_expiry_duration = 7
  tags                  = { Project = "fieldwork-router-lab" }
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
output "memory_id" { value = aws_bedrockagentcore_memory.fieldwork.id }
