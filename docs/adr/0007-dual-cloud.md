# Local first, portable later (AWS / OCI / similar)

**Current runtime is local.** Build and test on this workstation with Docker Compose and PostgreSQL 16. Do not `terraform apply` until a hosting platform is chosen.

Later production may be AWS, Oracle Cloud (OCI), or another similar private-VPC host. The app does not depend on a cloud vendor SDK at runtime: Postgres, object storage (local disk or S3-compatible), and env-based secrets. Terraform modules under `infra/terraform/oci` and `infra/terraform/aws` are optional later blueprints (private VPC, managed PostgreSQL, private object storage, vault/secrets). They stay in the repo; they are not a deployment gate for v1 local work.

Self-hosted Postgres 16 is the local and air-gapped path. Cloud secrets would live in OCI Vault or AWS Secrets Manager only after apply.
