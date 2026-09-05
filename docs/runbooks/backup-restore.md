# Backup and restore

## Managed PostgreSQL (preferred)

Enable automated backups (7-day minimum) and a daily snapshot. Record the snapshot ID and PostgreSQL version.

Restore:

```bash
# AWS
aws rds restore-db-instance-from-db-snapshot --db-instance-identifier stoneos-pg-restore --db-snapshot-identifier SNAPSHOT

# OCI: restore the Database with PostgreSQL backup into a new private endpoint
```

Point a **disposable** `DATABASE_URL` at the restore. Never restore onto production in place without a freeze.

## Self-hosted alternative

```bash
pg_dump -Fc "$DATABASE_URL" > stoneos.dump
pg_restore --clean --if-exists -d "$RESTORE_URL" stoneos.dump
```

Rehearse restore quarterly. Record duration and row counts for `raw_block`, `slab`, `invoice`, `payment`.
