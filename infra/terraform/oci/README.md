# OCI Terraform

Creates a VCN with public (TLS proxy), private (API), and isolated DB subnets, a Vault, and a private Object Storage bucket.

Managed PostgreSQL (OCI Database with PostgreSQL) should be provisioned into `db_subnet_id` using the console or a follow-up module — the network and secrets layout is the hard part this module owns.

## Apply

```bash
terraform init
terraform plan -var-file=staging.tfvars
terraform apply -var-file=staging.tfvars
```

Put `SESSION_SECRET`, `DATABASE_URL`, and `BOOTSTRAP_TOKEN` in the Vault after apply. Never commit tfvars with secrets.

Self-hosted PostgreSQL is an alternative: run Postgres 16 in the DB subnet with the same migrations and a block-volume backup policy.
