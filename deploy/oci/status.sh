#!/usr/bin/env bash
# What the box is running and how the last redeploy went. Read-only.
#
#   ssh ... ubuntu@<ip> "bash /opt/stoneos/deploy/oci/status.sh"
#
# Healthy looks like: DEPLOY_EXIT=0, api and postgres "(healthy)", health
# {"status":"ok","database":"reachable"}, and the new-code markers present.
REPO=/opt/stoneos
cd "$REPO/deploy/oci" || exit 1
echo "== commit:  $(git -C "$REPO" log --oneline -1)  ($(git -C "$REPO" branch --show-current || echo detached))"
echo "== last deploy:"
if [ -f /tmp/stoneos-deploy.log ]; then
  grep -E '^== |DEPLOY_EXIT' /tmp/stoneos-deploy.log | tail -10
  grep -q DEPLOY_EXIT /tmp/stoneos-deploy.log || echo "(still running — check again shortly)"
else
  echo "(no deploy log on this boot)"
fi
echo "== containers:"
sudo -n docker compose --env-file .env ps --format 'table {{.Service}}\t{{.Status}}'
echo "== api health:"
sudo -n docker compose --env-file .env exec -T api wget -qO- http://127.0.0.1:4000/health/ready; echo
echo "== offsite backup configured: $(grep -qE '^STONEOS_BACKUP_PAR_URL=["]?https://' .env && echo yes || echo NO)"
echo "== backup timer: $(systemctl is-enabled stoneos-backup.timer 2>/dev/null || echo not-installed)"
