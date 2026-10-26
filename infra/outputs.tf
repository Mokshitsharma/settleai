output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "evidence_bucket_name" {
  description = "Name of the S3 evidence storage bucket"
  value       = aws_s3_bucket.evidence.bucket
}

output "ecr_repository_url" {
  description = "URL of the ECR container repository"
  value       = aws_ecr_repository.app.repository_url
}

output "rds_endpoint" {
  description = "RDS PostgreSQL connection endpoint"
  value       = aws_db_instance.postgres.endpoint
}
