# Separate state from the application stack: images and secret values survive redeploys.
resource "aws_ecr_repository" "images" {
  for_each             = toset(["web", "agent"])
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}
resource "aws_secretsmanager_secret" "models" {
  name                    = "${local.name}/model-credentials"
  description             = "Fieldwork POC provider credentials; values supplied outside Terraform"
  recovery_window_in_days = 7
}
output "repositories" {
  value = { for key, repo in aws_ecr_repository.images : key => repo.repository_url }
}
output "model_secret_arn" { value = aws_secretsmanager_secret.models.arn }
