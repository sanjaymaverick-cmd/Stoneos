# Second-machine restore

## Automated (GitHub-hosted runner)

CI job `restore-fresh-runner` downloads the dump artifact from `quality`, starts a new Postgres 16, `pg_restore`s it, and prints table counts. That job is the automated second machine. It does not tick the physical-PC checkbox.

## Human PC (Windows)

1. Copy a dump from the factory box (`HOST_BACKUP_DIR`, e.g. `E:/stoneos-backups/stoneos-YYYYMMDDTHHMMSS.dump`) onto the second PC.
2. Install Docker Desktop and Git.
3. From the repo:

```bash
DUMP_FILE=/path/to/stoneos.dump bash scripts/restore-second-machine.sh
```

4. Compare `var/restore-second-machine.json` `counts` to `var/backup-rehearse.json` from the factory workstation.
5. The physical-PC checkbox in `docs/production-readiness.md` is only ticked when a JSON from a **different hostname** is committed under `var/`.

Expected keys: `raw_block`, `slab`, `invoice`, `payment`. Schema: `var/restore-second-machine.example.json`.
