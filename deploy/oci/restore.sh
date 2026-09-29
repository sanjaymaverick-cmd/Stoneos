#!/usr/bin/env bash
# Restore a dump. Defaults to a SCRATCH database, not the live one.
#
# Restoring over live books is how a bad afternoon becomes an unrecoverable one.
# The default target is a throwaway database so you can look before you leap;
# point STONEOS_RESTORE_DB at the real one only when you have decided that is
# what you want.
#
# Usage:
#   ./restore.sh /path/to/stoneos-20260929T000000Z.dump
#   STONEOS_RESTORE_DB=stoneos ./restore.sh <dump>     # over the live database

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}"

DUMP="${1:?usage: restore.sh <dump file>}"
[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 1; }

TARGET="${STONEOS_RESTORE_DB:-stoneos_restore}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if [ "$TARGET" = "$POSTGRES_DB" ]; then
	echo
	echo "  This will DROP and rebuild the LIVE database '$TARGET'."
	echo "  Everything written since $(basename "$DUMP") will be gone."
	echo
	read -r -p "  Type the database name to confirm: " reply
	[ "$reply" = "$TARGET" ] || { echo "aborted"; exit 1; }
fi

log "recreating $TARGET"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
	-c "DROP DATABASE IF EXISTS \"$TARGET\";" \
	-c "CREATE DATABASE \"$TARGET\" OWNER \"$POSTGRES_USER\";"

log "restoring"
docker compose exec -T postgres \
	pg_restore -U "$POSTGRES_USER" -d "$TARGET" --no-owner --no-privileges < "$DUMP"

log "row counts in $TARGET"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$TARGET" -c "
  SELECT 'raw_block' AS table, count(*) FROM raw_block
  UNION ALL SELECT 'slab', count(*) FROM slab
  UNION ALL SELECT 'invoice', count(*) FROM invoice
  UNION ALL SELECT 'payment', count(*) FROM payment
  UNION ALL SELECT 'voucher', count(*) FROM voucher
  UNION ALL SELECT 'app_user', count(*) FROM app_user;"

log "done. Compare these against the source before trusting the restore."
if [ "$TARGET" != "$POSTGRES_DB" ]; then
	log "This was a scratch restore into '$TARGET'. The live database is untouched."
fi
