#!/usr/bin/env bash
# Update the Oracle box to the latest origin/main and restart StoneOS.
#
# Run ON the server, detached, because the build takes minutes and an SSH
# session (or a Windows PowerShell wrapper) can drop mid-build:
#
#   nohup bash /opt/stoneos/deploy/oci/redeploy.sh >/dev/null 2>&1 &
#
# Progress goes to /tmp/stoneos-deploy.log; the last line is DEPLOY_EXIT=<n>.
# Read it with deploy/oci/status.sh. Roll back with:
#
#   ROLLBACK_TO=<commit> nohup bash /opt/stoneos/deploy/oci/redeploy.sh >/dev/null 2>&1 &
#
# Order matters: refuse a dirty checkout, back up, pull, build, migrate. A failed
# build leaves the old containers running (compose only replaces on success).
set -uo pipefail

# `git pull` below may rewrite this very file, and bash reads scripts as it goes.
# Run from a private copy so an update can never splice two versions together.
if [ -z "${STONEOS_REDEPLOY_COPY:-}" ]; then
  copy=$(mktemp /tmp/stoneos-redeploy.XXXXXX)
  cp "$0" "$copy"
  STONEOS_REDEPLOY_COPY=1 exec bash "$copy" "$@"
fi

LOG=/tmp/stoneos-deploy.log
REPO=/opt/stoneos
cd "$REPO/deploy/oci" || exit 1

exec > "$LOG" 2>&1
status=0
finish() { echo "DEPLOY_EXIT=$status"; exit "$status"; }

echo "== $(date -u +%FT%TZ) start; running $(git -C "$REPO" log --oneline -1)"
git -C "$REPO" rev-parse HEAD > /tmp/stoneos-previous-commit
echo "== previous commit saved to /tmp/stoneos-previous-commit"

if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; then
  echo "== REFUSING: the server checkout has local edits. Inspect with git -C $REPO status."
  status=2; finish
fi

echo "== pre-deploy backup"
if ! sudo -n ./backup.sh; then
  # A local dump that verified is still a usable rollback point; only an
  # unreadable dump is a reason to stop.
  if ! ls -t /mnt/stoneos/backups/stoneos-*.dump >/dev/null 2>&1; then
    echo "== REFUSING: no backup could be written"; status=3; finish
  fi
  echo "== backup exited non-zero (upload not configured?); local dump kept, continuing"
fi

if [ -n "${ROLLBACK_TO:-}" ]; then
  echo "== rolling back to $ROLLBACK_TO"
  git -C "$REPO" fetch -q origin && git -C "$REPO" checkout -q --detach "$ROLLBACK_TO" || { status=4; finish; }
else
  git -C "$REPO" checkout -q main && git -C "$REPO" pull -q --ff-only || { echo "== pull failed"; status=4; finish; }
fi
echo "== deploying $(git -C "$REPO" log --oneline -1)"

sudo -n docker compose --env-file .env up -d --build
status=$?
echo "== build exit $status"
if [ "$status" -eq 0 ]; then
  sudo -n docker compose --env-file .env --profile tasks run --rm migrate
  status=$?
  echo "== migrate exit $status"
fi
sudo -n docker compose --env-file .env ps
finish
