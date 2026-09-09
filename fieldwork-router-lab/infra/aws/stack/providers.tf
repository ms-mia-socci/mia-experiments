terraform {
  required_version = ">= 1.10"
  required_providers {
    random = { source = "hashicorp/random", version = "~> 3.9" }
    aws    = { source = "hashicorp/aws", version = "~> 6.63" }
  }
}
provider "aws" {
  profile             = "medplum"
  region              = "us-east-1"
  allowed_account_ids = ["229015218172"]
  default_tags {
    tags = { Project = "fieldwork-router-lab", Environment = "poc", ManagedBy = "terraform" }
  }
}
locals {
  name       = "fieldwork-router-lab"
  account_id = "229015218172"
  region     = "us-east-1"
}
