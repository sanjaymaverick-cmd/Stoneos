# AWS Terraform (not selected)

This module is a draft. Hosting platform is not decided; do not `terraform init` / `plan` / `apply` this directory until that choice is made.

If AWS is chosen later: private VPC, NAT, RDS PostgreSQL 16, S3 (private), and Secrets Manager. The ALB security group only accepts HTTPS from `allowed_cidr` (VPN/office). After apply, store `DATABASE_URL` and `SESSION_SECRET` in Secrets Manager. Do not make RDS public.
