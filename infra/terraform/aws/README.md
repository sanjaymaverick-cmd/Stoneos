# AWS Terraform

Private VPC, NAT, RDS PostgreSQL 16, S3 (private), and Secrets Manager. The ALB security group only accepts HTTPS from `allowed_cidr` (VPN/office).

```bash
terraform init
terraform plan
terraform apply
```

After apply, store `DATABASE_URL` and `SESSION_SECRET` in Secrets Manager. Point ECS/App Runner/EC2 in the private subnets at RDS. Do not make RDS public.
