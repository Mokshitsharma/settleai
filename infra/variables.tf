variable "aws_region" {
  type        = string
  description = "AWS region to deploy resources into"
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Project name prefix for tags and identifiers"
  default     = "settleai"
}

variable "environment" {
  type        = string
  description = "Deployment environment name"
  default     = "production"
}

variable "db_password" {
  type        = string
  description = "Master password for RDS PostgreSQL instance"
  sensitive   = true
  default     = "ChangeMeInProd123!"
}
