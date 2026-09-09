terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}
provider "aws" {
  region = "us-east-1"
  default_tags { tags = { Project = "claude-agent-poc", ManagedBy = "terraform" } }
}
resource "aws_ecr_repository" "images" {
  for_each             = toset(["agent", "web"])
  name                 = "claude-agent-poc/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}
resource "aws_secretsmanager_secret" "anthropic" {
  name                    = "claude-agent-poc/anthropic-api-key"
  description             = "Anthropic key populated outside Terraform; never stored in Terraform state"
  recovery_window_in_days = 7
}
output "repositories" { value = { for k, v in aws_ecr_repository.images : k => v.repository_url } }
output "secret_arn" { value = aws_secretsmanager_secret.anthropic.arn }
