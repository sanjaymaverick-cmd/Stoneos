output "postgres_endpoint" {
  description = "RDS endpoint for DATABASE_URL"
  value       = aws_db_instance.postgres.address
}

output "files_bucket" {
  description = "Object storage bucket for /files off-box"
  value       = aws_s3_bucket.files.id
}

output "backup_bucket" {
  description = "Backup bucket (same files bucket until a dedicated backup bucket is split out)"
  value       = aws_s3_bucket.files.id
}
