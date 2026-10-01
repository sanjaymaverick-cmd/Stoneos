#!/usr/bin/env bash
# Nightly backup: pg_dump plus the uploaded-files directory, then off the box.
#
# Read this before trusting it: this is a SNAPSHOT backup, so the most you can
# lose is everything written since the last run. At the default daily schedule
# that is up to 24 hours of production logs, sales orders and expense entries.
# Postgres can do better (WAL archiving, point-in-time recovery) but not without
# more machinery than one free VM deserves. If a day's loss is unacceptable, run
# this hourly, or move the database somewhere that does PITR for you.
#
# Uploading off the box is the whole point. A dump sitting on the same instance
# is not a backup — it dies with the instance.
#
# The files matter as much as the database here: rokad, DPR and khata scans are
# written to local disk because the S3/OCI storage driver is a stub that throws
# (packages/storage/src/index.ts). Losing them loses the source documents behind
# the ledger.
#
# Usage:  ./backup.sh            (reads .env beside this script)
# Timer:  see stoneos-backup.timer

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}" "${STONEOS_DATA_DIR:?}"

BACKUP_DIR="${STONEOS_BACKUP_DIR:-$STONEOS_DATA_DIR/backups}"
RETAIN_DAYS="${STONEOS_BACKUP_RETAIN_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$BACKUP_DIR/stoneos-$STAMP.dump"
FILES="$BACKUP_DIR/stoneos-files-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

upload() {
	local path="$1"
	[ -n "${STONEOS_BACKUP_PAR_URL:-}" ] || return 0
	if curl --fail --silent --show-error -X PUT \
		-T "$path" "${STONEOS_BACKUP_PAR_URL%/}/$(basename "$path")"; then
		log "uploaded $(basename "$path")"
	else
		# Loud, and a non-zero exit, so the systemd unit records a failure. A
		# silent upload failure is how you discover months later that the only
		# copies were on the box that just died.
		log "FAILED: upload of $(basename "$path") did not succeed — local copy kept"
		return 1
	fi
}

# -Fc is the custom format: compressed, and pg_restore can do selective restores
# from it. Plain SQL cannot.
log "dumping $POSTGRES_DB"
docker compose exec -T postgres \
	pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DUMP.partial"

# Only becomes a real filename once the dump has fully succeeded, so a run killed
# halfway never leaves something that looks like a good backup.
mv "$DUMP.partial" "$DUMP"
log "wrote $DUMP ($(du -h "$DUMP" | cut -f1))"

# A dump pg_restore cannot read is not a backup. Listing the archive table of
# contents catches truncation and corruption now rather than during an emergency.
# The archive goes in on stdin with no file argument: inside `docker compose exec`,
# naming /dev/stdin does not reach the piped file, so every good dump failed here.
if ! docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null 2>&1; then
	log "FAILED: $DUMP is not a readable pg_restore archive"
	exit 1
fi
log "verified archive is readable"

# Uploaded source documents. Empty on a fresh box, which is fine.
if [ -d "$STONEOS_DATA_DIR/storage" ]; then
	tar -czf "$FILES.partial" -C "$STONEOS_DATA_DIR" storage
	mv "$FILES.partial" "$FILES"
	log "wrote $FILES ($(du -h "$FILES" | cut -f1))"
	if ! tar -tzf "$FILES" > /dev/null 2>&1; then
		log "FAILED: $FILES is not a readable archive"
		exit 1
	fi
else
	log "WARNING: $STONEOS_DATA_DIR/storage does not exist — no file backup taken"
fi

if [ -n "${STONEOS_BACKUP_PAR_URL:-}" ]; then
	log "uploading to object storage"
	upload "$DUMP"
	[ -f "$FILES" ] && upload "$FILES"
else
	log "WARNING: STONEOS_BACKUP_PAR_URL is unset — this backup exists ONLY on this box"
fi

# Local pruning only. Remote copies are pruned by an Object Storage lifecycle
# rule, so a compromised box cannot delete its own backup history.
find "$BACKUP_DIR" \( -name 'stoneos-*.dump' -o -name 'stoneos-files-*.tar.gz' \) \
	-type f -mtime "+$RETAIN_DAYS" -print -delete |
	while read -r old; do log "pruned $old"; done

log "done"
