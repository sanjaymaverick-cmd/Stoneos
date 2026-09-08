#!/usr/bin/env bash
# Restore a factory dump onto a disposable Postgres on THIS machine.
# Intended for a second workstation / laptop (not the live factory SSD).
#
# Usage:
#   DUMP_FILE=/path/to/stoneos-YYYYMMDD.dump bash scripts/restore-second-machine.sh
#
# Optional:
#   RESTORE_PORT=55433 RESTORE_NAME=stoneos-restore-drill
set -euo pipefail

DUMP_FILE=${DUMP_FILE:-}
RESTORE_NAME=${RESTORE_NAME:-stoneos-restore-drill}
RESTORE_PORT=${RESTORE_PORT:-55433}
RESTORE_PASS=${RESTORE_PASS:-stoneos_restore_ci}
OUT=${OUT:-var/restore-second-machine.json}

if [[ -z "$DUMP_FILE" || ! -f "$DUMP_FILE" ]]; then
  echo "DUMP_FILE must point at an existing pg_dump -Fc file" >&2
  echo "example: DUMP_FILE=\$HOME/stoneos-backups/stoneos-20260906.dump $0" >&2
  exit 2
fi

mkdir -p "$(dirname "$OUT")"
START=$(date +%s)

if ! docker info >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 2
fi

docker rm -f "$RESTORE_NAME" >/dev/null 2>&1 || true
docker run -d --name "$RESTORE_NAME" \
  -e POSTGRES_USER=stoneos \
  -e POSTGRES_PASSWORD="$RESTORE_PASS" \
  -e POSTGRES_DB=stoneos \
  -e TZ=Asia/Kolkata \
  -p "$RESTORE_PORT:5432" \
  postgres:16-alpine >/dev/null

for i in $(seq 1 30); do
  if docker exec "$RESTORE_NAME" pg_isready -U stoneos -d stoneos >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec -i "$RESTORE_NAME" \
  psql -U stoneos -d postgres -c "DROP DATABASE IF EXISTS stoneos_restore;" >/dev/null
docker exec -i "$RESTORE_NAME" \
  psql -U stoneos -d postgres -c "CREATE DATABASE stoneos_restore;" >/dev/null
docker exec -i "$RESTORE_NAME" \
  pg_restore -U stoneos --no-owner -d stoneos_restore < "$DUMP_FILE"

COUNTS=$(docker exec -i "$RESTORE_NAME" \
  psql -U stoneos -d stoneos_restore -At -c \
  "SELECT 'raw_block='||count(*) FROM raw_block UNION ALL SELECT 'slab='||count(*) FROM slab UNION ALL SELECT 'invoice='||count(*) FROM invoice UNION ALL SELECT 'payment='||count(*) FROM payment;")

END=$(date +%s)
HOST=$(hostname)
python3 - "$OUT" "$DUMP_FILE" "$COUNTS" "$START" "$END" "$HOST" "$RESTORE_PORT" <<'PY'
import json, sys
out, dump, counts, start, end, host, port = sys.argv[1:]
payload = {
  "host": host,
  "dump": dump,
  "port": int(port),
  "seconds": int(end) - int(start),
  "counts": dict(x.split("=", 1) for x in counts.splitlines() if "=" in x),
  "database_url": f"postgresql://stoneos:***@127.0.0.1:{port}/stoneos_restore",
}
with open(out, "w", encoding="utf-8") as f:
  json.dump(payload, f, indent=2)
  f.write("\n")
print(json.dumps(payload, indent=2))
PY

echo "container=$RESTORE_NAME  (docker rm -f $RESTORE_NAME when finished)"
echo "point a disposable API at postgresql://stoneos:${RESTORE_PASS}@127.0.0.1:${RESTORE_PORT}/stoneos_restore"
echo "compare counts to var/backup-rehearse.json from the factory workstation"
