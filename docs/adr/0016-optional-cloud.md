# ADR 0016 — Optional cloud apply

## Status

Accepted. 2026-09-12.

## Decision

Local-first remains the default (`STORAGE_DRIVER=local`, Compose Postgres 16). Cloud is an implemented option: `scripts/cloud-apply.sh` and workflow_dispatch `cloud-apply` with environment `production-cloud`. Apply never runs on push to main. Missing AWS_*/OCI_* secrets fail the workflow; they do not skip-success. Factory data residency is the chosen region. Outputs: postgres endpoint, files bucket, backup bucket.
