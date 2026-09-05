# Deploy and rollback

## Staging

1. `terraform apply` in `infra/terraform/oci` or `infra/terraform/aws`.
2. Store `DATABASE_URL`, `SESSION_SECRET` (>=32 chars, not a placeholder), and `BOOTSTRAP_TOKEN` in Vault / Secrets Manager.
3. Build and push `stoneos-api` and `stoneos-web` images from CI digests.
4. Run `npx prisma migrate deploy` as a job against managed Postgres.
5. Run `npx tsx src/bootstrap.ts` **once**. Destroy `BOOTSTRAP_TOKEN` after success.
6. Confirm `/health/ready` returns database reachable.
7. Four-role smoke: owner, manager, supervisor, operator.

## Rollback

1. Do not `prisma migrate resolve` a failed migration without review.
2. Restore the last proven database backup (see `docs/runbooks/backup-restore.md`).
3. Redeploy the previous image digest.
4. SQL down-migrations are not a rollback plan.

## Stop criteria

Stop and restore if migrate deploy fails, health is red, or inventory/financial totals disagree with the pre-deploy snapshot.
