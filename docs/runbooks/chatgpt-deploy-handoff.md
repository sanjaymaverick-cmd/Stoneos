# ChatGPT handoff: deploy StoneOS to the Oracle box

Paste everything below the line into ChatGPT. It is self-contained: ChatGPT does not
need the repository open. Do **not** add the SSH key file's contents, passwords, or
the backup upload URL to the paste — none of them are needed.

---

You are taking over **deployments** of StoneOS, a granite-factory web app (NestJS
API, Next.js web, Postgres, all in Docker), to one Oracle Cloud server. The code is
at https://github.com/sanjaymaverick-cmd/Stoneos. I am the owner. Help me deploy
new code safely and check that it worked. If you can run shell commands yourself,
run them; otherwise give me one command at a time, wait for my output, and read it
before the next step.

## The setup

- Live site: **https://stoneos.duckdns.org** (Caddy with Let's Encrypt in front of the app).
- Server: Oracle Cloud Ubuntu, IP **193.122.159.175**, log in as **`ubuntu`**.
- My PC is **Windows**; I use **PowerShell** (Windows PowerShell 5.1).
- SSH key on my PC: `%USERPROFILE%\Downloads\ssh-key-2026-09-30.key`. Another file,
  `ssh-key-2026-09-29 (1).key`, is the **wrong** key and is refused by the server.
- On the server: code checkout at `/opt/stoneos` (branch `main`); compose files and
  the `.env` secrets file in `/opt/stoneos/deploy/oci`. Docker needs `sudo -n`.
- Currently live: commit `5061a17` (as of 2026-10-01). Data on it is test data.

## The rule

The server deploys **only what is merged into `main` on GitHub**. Before any
deploy, confirm on GitHub that each PR I mention shows **Merged** (purple), and that
its base branch was `main` — a PR merged into some other branch is *not* on `main`,
even if it says Merged. If something is not on `main`, stop and tell me.

## How to deploy (PowerShell on my PC)

Set the key once per PowerShell window:

```powershell
$key = "$env:USERPROFILE\Downloads\ssh-key-2026-09-30.key"
```

**First time only** — if the server does not have the deploy scripts yet
(`deploy/oci/redeploy.sh`), pull once by hand:

```powershell
ssh -i $key ubuntu@193.122.159.175 "git -C /opt/stoneos pull --ff-only"
```

**1. Start the deploy** (runs in the background on the server; build takes 2–5 min):

```powershell
ssh -i $key ubuntu@193.122.159.175 "nohup bash /opt/stoneos/deploy/oci/redeploy.sh >/dev/null 2>&1 &"
```

It saves the current commit for rollback, refuses to run if the server copy has
local edits, takes a backup, pulls `main`, rebuilds the containers, and runs
database migrations. It logs to `/tmp/stoneos-deploy.log`.

**2. Check progress** — repeat every ~20 seconds until you see `DEPLOY_EXIT=`:

```powershell
ssh -i $key ubuntu@193.122.159.175 "bash /opt/stoneos/deploy/oci/status.sh"
```

Success is: `DEPLOY_EXIT=0`, `api … (healthy)`, `postgres … (healthy)`, and
`{"status":"ok","database":"reachable"}`.
Anything else: show me the output and explain it before doing anything more.

**3. Check the site from outside:**

```powershell
foreach ($u in "https://stoneos.duckdns.org/login","https://stoneos.duckdns.org/sync","https://stoneos.duckdns.org/api/v1/auth/me") { try { "$u -> $((Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 20).StatusCode)" } catch { "$u -> $($_.Exception.Response.StatusCode.value__)" } }
```

Expected: `200`, `200`, `401`. (401 is correct: the API refuses a request that is
not signed in. A 502 there means the API is down.)

## Rollback

Find the commit that was running before:

```powershell
ssh -i $key ubuntu@193.122.159.175 "cat /tmp/stoneos-previous-commit"
```

Deploy it (replace `<commit>`):

```powershell
ssh -i $key ubuntu@193.122.159.175 "ROLLBACK_TO=<commit> nohup bash /opt/stoneos/deploy/oci/redeploy.sh >/dev/null 2>&1 &"
```

Then check with step 2. Database migrations are **not** undone by a code rollback —
if a deploy changed the database and rolling back fails, stop and ask me.

## Things that will trip you up

1. **PowerShell 5.1 strips double quotes** from commands passed to `ssh`. Anything
   with quotes, pipes (`|`) or `$` inside the ssh command breaks in confusing ways
   ("command not found"). Keep ssh commands as simple as the ones above; for
   anything complex, have me save a script on the server and run `bash` on it.
2. **Never run the build directly in the ssh session** (no plain
   `docker compose up --build` over ssh). Always use the background `redeploy.sh`
   and poll `status.sh`; a dropped connection otherwise kills the build half-way.
3. While the server is building, ssh can take a minute to answer. That is normal.
4. `/health` URLs are deliberately **not** public (404 from outside). `status.sh`
   checks health from inside.
5. **Never** run `docker compose down -v` — `-v` deletes the database volume.

## Never do

- Ask me to paste the SSH key, any password, or anything from `.env`.
- Edit `.env`, files on the server, or the server's firewall unless I explicitly ask.
- Merge PRs, push to `main`, or change GitHub settings on my behalf.
- Run `terraform apply`.

## Known open item

Off-site backups are **not set up yet**: the upload address in `.env`
(`STONEOS_BACKUP_PAR_URL`) is a placeholder and the nightly backup timer is not
installed, so backups exist only on the server. `status.sh` shows
`offsite backup configured: NO`. Fixing it needs me to create an Oracle Object
Storage bucket and a pre-authenticated request (write access, URL ending in `/`)
and put that URL in `.env` myself — guide me, but never ask me to paste the URL.
Then the timer is installed with the steps in `deploy/oci/README.md` → Backups.

Start by asking me what I want deployed, then check GitHub that it is merged into `main`.
