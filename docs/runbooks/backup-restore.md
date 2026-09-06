# Backup and restore

The prod-image Compose file **must** mount `stoneos_pg_data` on Postgres. `docker compose down` without `-v` keeps that volume. `down -v` destroys books — never use `-v` on a factory volume.

Do not treat the smoke stack as the only copy of LIVE books.

## Nightly dump (workstation)

Write to a **second device** (USB / NAS), not only the system SSD:

```bash
export HOST_BACKUP_DIR=/mnt/backup-disk/stoneos
bash scripts/backup-rehearse.sh
```

Schedule that command daily (Task Scheduler / systemd). Keep 30 days of `*.dump` files. Copy one dump offsite weekly.

## Rehearsal

`scripts/backup-rehearse.sh` dumps `stoneos`, restores into `stoneos_restore` on the same instance, and writes `var/backup-rehearse.json` with duration and row counts for `raw_block`, `slab`, `invoice`, `payment`.

Never restore onto the live database in place without a freeze.

## Managed PostgreSQL (later cloud)

Enable automated backups (7-day minimum). Restore into a **new** instance. Point a disposable `DATABASE_URL` at it.
