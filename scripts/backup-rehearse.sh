#!/usr/bin/env bash
# Dump the smoke/prod-compose Postgres volume to HOST_BACKUP_DIR and restore into a scratch DB.
set -euo pipefail
PROJECT=${COMPOSE_PROJECT:-stoneos-smoke}
FILE=${COMPOSE_FILE:-infra/compose/docker-compose.prod.yml}
HOST_BACKUP_DIR=${HOST_BACKUP_DIR:-$HOME/stoneos-backups}
STAMP=$(date +%Y%m%dT%H%M%S)
mkdir -p "$HOST_BACKUP_DIR"
DUMP="$HOST_BACKUP_DIR/stoneos-$STAMP.dump"
START=$(date +%s)

docker compose -p "$PROJECT" -f "$FILE" exec -T postgres \
  pg_dump -U stoneos -Fc stoneos > "$DUMP"

docker compose -p "$PROJECT" -f "$FILE" exec -T postgres \
  psql -U stoneos -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'stoneos_restore';" >/dev/null || true
docker compose -p "$PROJECT" -f "$FILE" exec -T postgres \
  psql -U stoneos -d postgres -c "DROP DATABASE IF EXISTS stoneos_restore;" 
docker compose -p "$PROJECT" -f "$FILE" exec -T postgres \
  psql -U stoneos -d postgres -c "CREATE DATABASE stoneos_restore;"

docker compose -p "$PROJECT" -f "$FILE" exec -T postgres \
  pg_restore -U stoneos --no-owner -d stoneos_restore < "$DUMP"

COUNTS=$(docker compose -p "$PROJECT" -f "$FILE" exec -T postgres \
  psql -U stoneos -d stoneos_restore -At -c \
  "SELECT 'raw_block='||count(*) FROM raw_block UNION ALL SELECT 'slab='||count(*) FROM slab UNION ALL SELECT 'invoice='||count(*) FROM invoice UNION ALL SELECT 'payment='||count(*) FROM payment;")
END=$(date +%s)
mkdir -p var
cat > var/backup-rehearse.json <<EOF
{"dump":"$DUMP","seconds":$((END-START)),"counts":$(printf '%s' "$COUNTS" | python -c 'import sys,json; print(json.dumps(dict(x.split("=",1) for x in sys.stdin.read().splitlines() if "=" in x)))')}
EOF
echo "dump=$DUMP"
echo "$COUNTS"
echo "seconds=$((END-START))"
