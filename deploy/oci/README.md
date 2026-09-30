# StoneOS on an Oracle Cloud Ampere A1

A runbook for one Always Free aarch64 box running the whole stack: Caddy for TLS,
the API and web containers behind it, PostgreSQL on an attached block volume.

This is deliberately separate from `infra/compose/docker-compose.prod.yml`, which
is a **smoke stack** — it carries hardcoded secrets, publishes two ports and has
no TLS. Do not point that file at the internet.

---

## What you need first

- An Ampere A1 instance, Ubuntu, aarch64. 4 OCPU / 24 GB is the Always Free
  allowance and is comfortable; 1 OCPU / 6 GB will build but slowly.
- A **block volume** attached and mounted (say `/mnt/stoneos`). The boot volume
  works for a trial, but the point of a separate volume is that you can snapshot
  and detach it.
- Docker Engine and the compose plugin.
- A DNS A record pointing at the instance's public IP, if you want real TLS.

### Two firewalls, not one

Oracle instances have **two** independent layers, and closing one does nothing
for the other:

1. **VCN security list / network security group** — in the OCI console. Open 80
   and 443 to `0.0.0.0/0`, and 22 to your own address only.
2. **The host firewall** — Ubuntu images ship with restrictive `iptables` rules.

There is a trap here worth stating plainly: **Docker writes its own iptables
rules ahead of the host's INPUT chain**, so a published container port is
reachable even when `ufw` says otherwise. The VCN list is what actually holds.
That is why this compose file publishes only Caddy's 80/443 and gives Postgres no
`ports:` at all.

---

## Connecting from Windows

The private key OCI gave you when the instance was created lands in your
Downloads folder. Move it somewhere permanent first — Downloads gets cleared:

```powershell
mkdir $env:USERPROFILE\.ssh -Force
move "$env:USERPROFILE\Downloads\ssh-key-*.key" "$env:USERPROFILE\.ssh\oracle-a1.key"
```

Windows OpenSSH refuses a key other accounts can read, with
`UNPROTECTED PRIVATE KEY FILE`. There is no `chmod` — use `icacls`:

```powershell
icacls "$env:USERPROFILE\.ssh\oracle-a1.key" /inheritance:r
icacls "$env:USERPROFILE\.ssh\oracle-a1.key" /grant:r "$($env:USERNAME):(R)"
```

Then connect. Ubuntu images log in as `ubuntu`, not `root` or `opc`:

```powershell
ssh -i "$env:USERPROFILE\.ssh\oracle-a1.key" ubuntu@<public-ip>
```

That key is the only thing standing between the internet and this box. Never
paste it anywhere, and keep a copy somewhere you will still have it if the
laptop dies — OCI cannot re-issue it. The public IP is not a secret; the key is.

---

## First deploy

```bash
sudo mkdir -p /opt && sudo chown "$USER" /opt
git clone https://github.com/sanjaymaverick-cmd/Stoneos /opt/stoneos
cd /opt/stoneos/deploy/oci

cp env.example .env
chmod 600 .env
$EDITOR .env          # fill in every blank; generate secrets, do not invent them
```

Create the data directories on the block volume:

```bash
sudo mkdir -p /mnt/stoneos/{postgres,storage,caddy/data,caddy/config,backups}
sudo chown -R "$USER" /mnt/stoneos
```

Build and start. The images build **on this box**, so they are aarch64 natively —
there is no cross-architecture build to get wrong, and Prisma already ships the
matching engine (`linux-musl-arm64-openssl-3.0.x`).

```bash
docker compose --env-file .env up -d --build
```

The first build takes several minutes on a fresh A1. Then, in order:

```bash
# 1. Schema. Not part of `up` — it is a one-shot task.
docker compose --env-file .env --profile tasks run --rm migrate

# 2. Let the API write to the uploads directory. The image creates that path as
#    the `stoneos` user, but a bind mount arrives owned by the host user, so fix
#    it once. This avoids having to know the container's uid.
docker compose --env-file .env run --rm --user root api \
  chown -R stoneos:stoneos /app/apps/api/data

# 3. First owner. This CREATES the login — there is no signup anywhere in the
#    app, so nobody can get in until this runs.
docker compose --env-file .env --profile tasks run --rm bootstrap
```

Then open `https://your-domain/login` and sign in as the bootstrap owner. You
will be forced to change the password before you can write anything.

**Now delete the bootstrap secrets from `.env`** — `BOOTSTRAP_TOKEN`,
`BOOTSTRAP_OWNER_PASSWORD`. The CLI refuses to run twice regardless (it writes a
`bootstrap_lock` row), but that password should not sit on disk.

There is no default owner password anywhere in this repository. The one you put
in `.env` *is* the owner login, it exists only from the moment bootstrap runs,
and the app forces you to replace it on first use.

---

## If you lock yourself out

The lockout policy applies to every account including the owner: **10 wrong
passwords lock the login for 5 minutes, and 5 more after that suspend it.** On
deployment day this is a live risk — the bootstrap password is generated, long,
and easy to mistype, and a suspended sole owner has nobody left inside the app
who can issue new credentials.

The way back does not go through the app:

```bash
cd /opt/stoneos/deploy/oci
docker compose --env-file .env --profile tasks run --rm unlock owner
```

That clears the failure counters, lifts any timed lock, un-suspends the account,
kills stale sessions and prints a **new** temporary password, which must be
changed on first login. Pass `--keep-password` to lift a lock without issuing a
new password. Either way it records itself in the audit trail as
`auth.unlock_cli`.

Paste the bootstrap password rather than typing it, and you will not need this.

---

## Changing the domain means rebuilding the web image

`NEXT_PUBLIC_API_URL` is compiled into the browser bundle at build time. Left
wrong, the app loads and every API call fails — a confusing, silent breakage. It
is set from `PUBLIC_URL`, so after changing that:

```bash
docker compose --env-file .env up -d --build web
```

---

## Backups

`backup.sh` dumps the database, tars the uploaded files, verifies both archives
are readable, and uploads them off the box. It exits non-zero if an upload fails,
because a silent upload failure is how you discover months later that the only
copies were on the instance that just died.

The files matter as much as the database: rokad, DPR and khata scans are written
to local disk, since the S3/OCI storage driver in `packages/storage` is a stub
that throws. Losing them loses the source documents behind the ledger.

Set up an Object Storage bucket and a **pre-authenticated request** with
object-write permission, ending in a slash, then put it in `.env` as
`STONEOS_BACKUP_PAR_URL`. A PAR rather than the `oci` CLI on purpose: no SDK to
install, no API signing key on the box, and it can be revoked on its own.

Install the timer:

```bash
sudo cp stoneos-backup.service stoneos-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stoneos-backup.timer
systemctl list-timers stoneos-backup    # confirm it is scheduled
```

Run one by hand first, and read the output:

```bash
./backup.sh
```

### Restoring

`restore.sh` defaults to a **scratch** database, not the live one, and prints row
counts so you can compare before trusting it:

```bash
./restore.sh /mnt/stoneos/backups/stoneos-20260929T011500Z.dump
```

Only when you have decided that is what you want:

```bash
STONEOS_RESTORE_DB=stoneos ./restore.sh <dump>   # prompts for confirmation
```

**Rehearse this before you put real books on the box.** A backup you have never
restored is a hypothesis, not a backup.

---

## Day to day

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f api
docker compose --env-file .env exec api wget -qO- http://127.0.0.1:4000/health
docker compose --env-file .env exec postgres psql -U stoneos -d stoneos
```

Update to a new commit:

```bash
git -C /opt/stoneos pull
docker compose --env-file .env up -d --build
docker compose --env-file .env --profile tasks run --rm migrate
```

Health endpoints are **not** published through Caddy. `/health` opens a database
connection and neither it nor `/health/live` belongs on the public internet; the
compose healthchecks reach them inside the network.

---

## What this does not give you

Worth knowing before real books go on it.

- **Point-in-time recovery.** These are nightly snapshots, so the most you can
  lose is a day. Run the timer hourly if that is too much, or move the database
  to a managed provider that does PITR.
- **A second machine.** One box is one failure domain. The block volume survives
  the instance, and the backups survive the volume, but there is no standby.
- **Rate limiting across restarts.** Login throttling is in-process
  (`apps/api/src/common/http-security.ts`), so a container restart resets the
  counters, and there is no account lockout at all.
- **Monitoring.** Nothing pages you. `docker compose ps` and the systemd timer's
  exit status are what you have.

The known gaps in the application itself — not the deployment — are recorded in
`docs/architecture-critic-review.md`.
