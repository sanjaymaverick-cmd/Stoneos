# Handoff: deploying StoneOS to the Oracle box

For an agent (or person) picking up deploys. Written 2026-10-01 after deploying
`5061a17` (PRs #11–#16). Read this whole page before touching the server.

The full first-time setup is in [`deploy/oci/README.md`](../../deploy/oci/README.md).
This page is the day-to-day update path and the traps that cost time.

---

## 1. The box

| Thing | Value |
|---|---|
| Public site | https://stoneos.duckdns.org (Caddy, Let's Encrypt) |
| Public IP | `193.122.159.175` (not a secret) |
| OS user | `ubuntu` (not `opc`, not `root`) |
| Checkout | `/opt/stoneos`, branch `main` |
| Compose dir | `/opt/stoneos/deploy/oci` (`.env` lives here, mode 600) |
| Data | `/mnt/stoneos/{postgres,storage,caddy,backups}` |
| Containers | `api`, `web`, `postgres`, `caddy` |

**SSH key.** On the owner's Windows PC the working key is
`%USERPROFILE%\Downloads\ssh-key-2026-09-30.key`. The similarly named
`ssh-key-2026-09-29 (1).key` is **not** authorised on this box (`Permission denied
(publickey)`). Both files are already restricted to the owner's account
(`icacls … /inheritance:r /grant:r <user>:(R)`); Windows OpenSSH refuses a key
that other accounts can read. Never print, copy into the repo, or paste the key.

**Docker needs sudo.** `ubuntu` is not in the `docker` group; every compose
command is `sudo -n docker compose --env-file .env …`. Passwordless sudo works
(`-n` makes it fail fast instead of prompting).

---

## 2. Deploy = merge to `main`, then three commands

The server only ever deploys **`origin/main`**. A branch that is not merged is not
deployable, by design.

### Before you start: are the PRs really merged?

Check GitHub, not the conversation:

```bash
gh api repos/sanjaymaverick-cmd/Stoneos/pulls/<N> --jq '"#\(.number) merged=\(.merged) base=\(.base.ref)"'
```

Two things went wrong here on 2026-10-01:

- The user reported PRs merged when GitHub still had them open (the confirm click
  had not gone through). Always check `merged=true` before deploying.
- **Stacked PRs.** PR #15 was based on `claude/offline-first` (stacked on #13). It
  was merged 10 seconds after #13, *before GitHub retargeted it to `main`*, so it
  landed on the dead feature branch and never reached `main`. It took PR #16 to
  carry the commit across. If a PR's `base` is not `main` when it is merged, its
  changes are not on `main`. Prefer basing every PR on `main`.

This session cannot merge PRs itself (`gh pr merge` is blocked by the agent's
permission policy as "merge without review"). The user merges on GitHub; the agent
verifies and deploys.

### The commands (run from the owner's PC, PowerShell)

```powershell
$key = "$env:USERPROFILE\Downloads\ssh-key-2026-09-30.key"
```

1. **Start the deploy** (detached on the server; the build takes 2–5 minutes):

   ```powershell
   ssh -i $key ubuntu@193.122.159.175 "nohup bash /opt/stoneos/deploy/oci/redeploy.sh >/dev/null 2>&1 &"
   ```

   `redeploy.sh` saves the running commit to `/tmp/stoneos-previous-commit`,
   refuses a checkout with local edits, takes a backup, `git pull --ff-only`,
   rebuilds, runs the `migrate` task, and logs to `/tmp/stoneos-deploy.log`.

2. **Watch it** until the log ends with `DEPLOY_EXIT=0` (re-run every ~20 s):

   ```powershell
   ssh -i $key ubuntu@193.122.159.175 "bash /opt/stoneos/deploy/oci/status.sh"
   ```

3. **Verify from outside:**

   ```powershell
   foreach ($u in "https://stoneos.duckdns.org/login","https://stoneos.duckdns.org/sync","https://stoneos.duckdns.org/api/v1/auth/me") { try { "$u -> $((Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 20).StatusCode)" } catch { "$u -> $($_.Exception.Response.StatusCode.value__)" } }
   ```

   Expect `200`, `200`, `401` (the API refuses an anonymous `/auth/me`; a 502 there
   means the API container is down).

**Healthy `status.sh` output:** `DEPLOY_EXIT=0`, `api … (healthy)`,
`postgres … (healthy)`, health `{"status":"ok","database":"reachable"}`.

> `redeploy.sh` and `status.sh` arrived in the repo *with* this handoff. If the
> server checkout predates them, do one manual pull first:
> `ssh -i $key ubuntu@193.122.159.175 "git -C /opt/stoneos pull --ff-only"`.

### Did the new code actually ship?

`/api/docs` is **not** evidence: most controllers type their bodies as plain
interfaces, which Swagger cannot see, so new fields never appear there. Look inside
the running container instead, e.g.:

```powershell
ssh -i $key ubuntu@193.122.159.175 "cd /opt/stoneos/deploy/oci && sudo -n docker compose --env-file .env exec -T api ls src/common/idempotency.ts"
```

---

## 3. Rollback

```powershell
ssh -i $key ubuntu@193.122.159.175 "cat /tmp/stoneos-previous-commit"
```
```powershell
ssh -i $key ubuntu@193.122.159.175 "ROLLBACK_TO=<that-commit> nohup bash /opt/stoneos/deploy/oci/redeploy.sh >/dev/null 2>&1 &"
```

That leaves the checkout on a detached commit; the next normal deploy returns it to
`main`. Migrations are forward-only: if a deploy ran a migration, rolling the code
back does **not** undo it. Stop and read `docs/runbooks/backup-restore.md` before
restoring a database. Never `docker compose down -v` — `-v` deletes the books.

---

## 4. Traps that cost time

1. **Windows PowerShell 5.1 strips double quotes** from arguments passed to native
   programs. `ssh … 'grep -E "a|b" file'` arrives as `grep -E a|b file` and runs `b`
   as a command. Do not inline anything with quotes, pipes or `$` into an ssh
   command line. Put it in a script on the server (that is why `status.sh` and
   `redeploy.sh` exist) or `scp` a script to `/tmp` and run `bash /tmp/x.sh`.
   Strip CRLF after `scp` from Windows: `sed -i 's/\r$//' /tmp/x.sh`.
2. **Never run the build in the foreground over ssh.** A dropped session or a tool
   timeout kills it half-way. Always `nohup … &` and poll `status.sh`.
3. **A slow ssh reply is the build, not a hang.** The box answers slowly while
   compiling; give ssh `-o ConnectTimeout=60` and a few minutes.
4. **Health endpoints are not public.** `/health/*` returns 404 through Caddy by
   design; check health inside the network (`status.sh` does).

---

## 5. Open items on the box (as of 2026-10-01)

- **Off-site backups are not configured.** `STONEOS_BACKUP_PAR_URL` in `.env` is a
  placeholder and `stoneos-backup.timer` is not installed, so every backup exists
  only on this instance. The owner must create an Object Storage bucket and a
  pre-authenticated request (write, URL ending in `/`) in the OCI console and put it
  in `.env` **themselves** — it is a credential; never ask for it in chat or log it
  (`status.sh` prints only yes/no). Then install the timer per
  `deploy/oci/README.md` → Backups, and run `sudo -n ./backup.sh` once to see
  `uploaded …`.
- Factory is still `SETUP` (opening count not approved); the dashboard warning is
  correct.
- The data on the box is mock data from dry runs; the owner plans to wipe it before
  real use (`docs/runbooks/backup-restore.md`, and re-run bootstrap).

## 6. What is live (5061a17)

Offline-first queue and `/sync` screen (#13), service-worker offline shell (#11),
backup verify fix (#14), volume dry-run script (#12), and the dry-run fixes (#16):
block weight 0 < t ≤ 60, consumable 409 + piece/litre units, no future-dated
payments/orders/expenses/attendance, month-to-date windowing, fuller receive-block,
slab, sales, expenses and muster screens.
