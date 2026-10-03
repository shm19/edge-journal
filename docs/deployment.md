# Deploying Edge Journal to your own server (SSH, no Docker)

You copy the code from your laptop to a Linux server over SSH, the server builds it, and a systemd service runs it. One command updates it later. **Your data is protected before every change**: nothing you do with these commands deletes your journal, and every deploy makes a verified backup first.

Everything goes through one script on your laptop: `./scripts/server.sh <command>` (same as `npm run server -- <command>`). `./scripts/server.sh --help` lists the commands.

## Before you start
You need:
- A Linux server you can SSH into as a user with `sudo`. Tested design: Debian or Ubuntu with systemd, x86_64 or arm64. Other distros work if you install the packages yourself.
- About 1.5 GB of RAM **plus swap** (the build needs it; `init --add-swap` adds a swapfile) and 2 GB of free disk.
- The server must reach the internet (npm, GitHub) while building.
- On your laptop: this repo with your changes **committed** (the server gets `git archive HEAD`), `ssh`, `scp`, Node 22 (for the quick local checks before a deploy).

Not sure what your server has? Create the config, then ask it:
```bash
cp deploy/deploy.env.example .deploy.env     # edit SERVER=you@1.2.3.4 (and SSH_PORT / SSH_KEY if needed)
./scripts/server.sh doctor
```
`doctor` changes nothing. It reports OS, systemd, sudo, Node, sqlite3, memory, disk, network, Docker (informational) and the port, then says **READY** or lists the exact commands to fix each problem.

## First deploy in 6 steps
1. **Config.** `.deploy.env` (gitignored) holds `SERVER`, `SSH_PORT`, `SSH_KEY`, `BIND`, `PORT`, `LOCAL_BACKUP_DIR`. No secrets in it.
2. **Doctor.** `./scripts/server.sh doctor`, fix what it lists.
3. **Init (once).** `./scripts/server.sh init` (add `--install-node` if Node 22 is missing, `--add-swap` if RAM+swap < 2 GB). It tells you what it will install and waits for your `y`, asks for your **app password** (hidden, typed twice, 10+ characters) and generates `SESSION_SECRET` itself. It creates a locked system user `edge-journal`, the directories, the systemd service and the daily backup timer. You choose how the app listens (see "Reaching the app"). Running it again is harmless and never changes your password or secret.
4. **Deploy.** Commit, then `./scripts/server.sh deploy`. It runs `npm run typecheck` and the tests locally, ships the commit, builds on the server (a few minutes the first time), starts it and waits for `/api/health`. Don't close the terminal while it runs (if the connection drops, the server finishes or rolls back on its own: `./scripts/server.sh status`).
5. **Open it.** `./scripts/server.sh tunnel` and browse to `http://localhost:3000` (Chrome or Firefox), log in with your password.
6. **Copy your backups off the server.** `./scripts/server.sh pull-backups`, then automate it (below). A backup on the same machine is not a backup.

## Updating
Commit your changes, then `./scripts/server.sh deploy` (`--skip-checks` skips the local tests, `--allow-dirty` deploys HEAD without your uncommitted edits). On the server it:
1. takes a lock (two deploys can't overlap) and checks memory, disk, Node;
2. unpacks into a new `releases/<time>-<commit>` folder and runs `npm ci` + `npm run build` as the service user. **The old version keeps running meanwhile.** The build gets a throwaway data dir, never your real database;
3. makes a **verified backup** (database + screenshots) into `/var/backups/edge-journal/pre-deploy` and aborts the whole deploy if that fails;
4. switches the `current` link atomically, restarts, and waits up to 90 s for a healthy `/api/health`. The app migrates the database on that first request, after writing its own copy to `data/backups/pre-migrate-*.db`;
5. if it is not healthy: switches back to the previous release; if the old code cannot read the (already migrated) database, it restores the pre-deploy backup. It tells you loudly what happened and where every copy is;
6. keeps the newest 2 releases (plus the current one) and removes older ones.

Exit codes of `deploy`: `0` ok, `1` failed before anything live changed, `2` rolled back to the previous code, `3` rolled back and the database restored from the pre-deploy backup, `4` failed and the app is **not** healthy (all copies intact), `6` first deploy failed.

## Backups
| What | Where | How often |
|---|---|---|
| Daily backup (DB + screenshots) | `/var/backups/edge-journal` on the server, newest 30 | systemd timer `edge-journal-backup.timer`, ~03:00 (runs at the next boot if the server was off) |
| Pre-deploy backup | `/var/backups/edge-journal/pre-deploy`, newest 10 | every deploy |
| The app's own pre-migration copy | `/var/lib/edge-journal/backups/pre-migrate-*.db`, newest 3 | before each pending migration |
| **Off-site copy** | `LOCAL_BACKUP_DIR` (default `~/edge-journal-backups`) on your laptop | when you run `pull-backups` |

`./scripts/server.sh backup` makes one now. `./scripts/server.sh pull-backups [-n 7]` copies the newest N databases and the newest screenshots archive to your laptop (the server stages them with `sudo`, because the service user's files are private), checks each `.db` with `sqlite3` and deletes the staged file. It never deletes old copies on your laptop; clean them up yourself. `./scripts/server.sh status` warns when the newest server backup is over 36 hours old or when your newest local copy is over 7 days old.

**Automate it** (cron on your laptop, every night at 04:00; needs an SSH key without a passphrase or a loaded agent, and passwordless `sudo` for your server user):
```
0 4 * * * cd /path/to/edge-journal && ./scripts/server.sh pull-backups >> ~/edge-journal-backups/pull.log 2>&1
```
On macOS a laptop that is asleep at 04:00 skips the run, and cron may need Full Disk Access (System Settings → Privacy). A `launchd` agent with `StartCalendarInterval` and the same command works too. Without passwordless sudo, run `pull-backups` by hand once a week; `status` reminds you.

## Moving your current local data to the server
Your local data lives in the folder `DATA_DIR` points to (see `.env.local`; on this machine `.data-dev` is QA test data and `.data-backtest` is the backtest instance: ship only what you want to keep). Make a consistent copy (never copy a live `journal.db` alone: its `-wal` file holds recent data), then restore it:
```bash
sqlite3 .data-dev/journal.db ".backup 'to-server.db'"
tar -czf to-server-uploads.tar.gz -C .data-dev uploads        # optional: screenshots
./scripts/server.sh restore to-server.db to-server-uploads.tar.gz
```
(Alternatively use Settings → Export & backup → Database; that file has no screenshots.) `restore` asks you to type `RESTORE`, stops the app for a few seconds, keeps the database it replaces as `journal.db.pre-restore-<time>` and starts the app. Deploy the same version first: a database from a **newer** app version than the one on the server is refused ("database is newer").

## If something goes wrong
- **Look first:** `./scripts/server.sh status`, `./scripts/server.sh logs -n 200` (add `-f` to follow), `./scripts/server.sh health`. The deploy log is `/var/log/edge-journal-deploy.log` on the server.
- **A deploy failed:** read its last lines; it already rolled back or told you the state (exit codes above).
- **Go back to the previous version:** `./scripts/server.sh rollback`. If the old code refuses the newer database it says so and offers (type `RESTORE`) to restore the pre-deploy backup. The trade-off: **everything written since that backup is lost**; the database as it is now is still kept as `journal.db.pre-restore-*`.
- **Restore a backup:** `./scripts/server.sh restore <journal-STAMP.db> [uploads-STAMP.tar.gz]` (any file from `pull-backups`, `/var/backups/...` copied down, or a pre-migrate copy). Use the db and uploads with the same STAMP.
- **Nothing is ever deleted by these commands** except old releases, old backups past their retention, and staging files. To free space from `.pre-restore-*` copies, delete them yourself once you are sure.

## Reaching the app
You choose at `init` (or change `BIND` in `.deploy.env`, then `init --rebind`):
1. **`127.0.0.1` only (recommended).** Nothing is exposed. `./scripts/server.sh tunnel` opens an SSH tunnel; browse to `http://localhost:3000`. The session cookie stays `Secure` (Chrome and Firefox accept that on localhost; Safari does not, so use another browser or option 2).
2. **All interfaces (`0.0.0.0`) on a private network / LAN / VPN only.** Browse to `http://<server ip>:3000`. The password and session cookie travel in **plain HTTP**, so anyone on that network path can read them, and `init` sets `COOKIE_SECURE=false` for it. Restrict the port to your own IP, e.g. with ufw (`init` prints the lines with your IP): `sudo ufw allow OpenSSH`, `sudo ufw allow from <your IP> to any port 3000 proto tcp`, `sudo ufw enable`.

**Never expose option 2 to the public internet.** Without HTTPS, anyone between you and the server (café Wi-Fi, a router, an ISP) can read the journal and steal the session. If you ever want internet access, use the Docker/Caddy path in the README (HTTPS, HSTS) or put your own TLS proxy in front.

## Security notes
- The app runs as the locked system user `edge-journal` (no login shell) with `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`; it can write only its data folder, its backup folder and the `.next/cache` of the release. The code is root-owned and read-only to it.
- `/etc/edge-journal/edge-journal.env` (password, secret, listen address) is `root:root 0600`. Data and backup folders are `0700`.
- Secrets are typed or generated on your laptop and sent over SSH **stdin**: never on a command line, never in a log. The scripts print no secret.
- `--reset-password` and `--rotate-secret` (on `init`) are the only ways the password or `SESSION_SECRET` change, and both log everyone out.
- No proxy sits in front of the app, so there is no `X-Forwarded-For`: the per-client login throttle then has one shared bucket and can be dodged with a forged header; the global limiter in `src/lib/login-guard.ts` still caps guesses (see docs/security.md). Keep the app off the internet.
- Keep the server patched (`sudo apt update && sudo apt upgrade`) and SSH on keys.

## Data-safety guarantees (and what tests them)
`src/deploy-scripts.test.ts` simulates the server side (temp root, stub `systemctl`, a fake app on real SQLite) and the laptop script (stub `ssh`/`scp`).
| | Guarantee |
|---|---|
| I1 | The data lives outside the release folders (`/var/lib/edge-journal`); deploy, rollback and pruning cannot touch it. |
| I2 | Every deploy makes a verified backup first and aborts if it cannot (not applicable only to the very first deploy). |
| I3 | An unhealthy release means an automatic switch back to the old code; the database is restored from the pre-deploy backup only if the old code cannot run on it. Nothing is deleted. |
| I4 | Daily timer backups (newest 30) plus the `pull-backups` off-site flow. |
| I5 | `restore` never deletes existing data: the replaced database is always kept as `.pre-restore-*`. |
| I6 | Secrets never appear in arguments or logs; the env file is `0600` root. |
| I7 | `init` is idempotent and never rotates the secret or password silently. |
| I8 | A lock prevents overlapping deploys, restores and rollbacks. |
| I9 | The app's own pre-migrate copy (`data/backups/pre-migrate-*.db`, newest 3) still applies. |

## Server layout
`/opt/edge-journal/releases/<id>/` (code, root-owned) · `/opt/edge-journal/current` (symlink) · `/opt/edge-journal/.home` (npm cache of the service user) · `/var/lib/edge-journal` (database, `uploads/`, `backups/`) · `/var/backups/edge-journal` · `/etc/edge-journal/edge-journal.env` · `/etc/systemd/system/edge-journal*.{service,timer}` · `/var/log/edge-journal-deploy.log` · `~/edge-journal-incoming` (staging in your home; scripts and tarballs, cleaned up).

## Uninstall (keeping your data)
```bash
sudo systemctl disable --now edge-journal edge-journal-backup.timer
sudo rm /etc/systemd/system/edge-journal*.service /etc/systemd/system/edge-journal-backup.timer && sudo systemctl daemon-reload
sudo rm -rf /opt/edge-journal            # the code only
```
Your data stays in `/var/lib/edge-journal` and `/var/backups/edge-journal` (and `/etc/edge-journal`). Copy them off first with `pull-backups`. Delete those three folders and `sudo userdel edge-journal` only when you really want everything gone.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Cannot run commands on ...` | Check `SERVER`, `SSH_PORT`, `SSH_KEY`; try `ssh user@host` by hand. |
| `npm ci failed` or `Killed` during the build | Not enough memory: `init --add-swap`. A download error: check `doctor`'s network lines; without GitHub access `build-essential` + `python3` must be installed (init does that). |
| Deploy says Node 22 is missing | `./scripts/server.sh init --install-node`. |
| Health stays 503, log says `database is newer` | The database came from a newer version than the code. Deploy the newer code, or `rollback` / `restore`. |
| `Could not write the pre-migration backup` | Disk full or `/var/lib/edge-journal/backups` not writable: free space, then `sudo systemctl restart edge-journal`. |
| Browser shows the login page again and again | Safari + tunnel (Secure cookie on http): use Chrome/Firefox or option 2. Or the password/secret was changed (everyone is logged out). |
| `next start` prints a standalone warning in the log | Harmless: the full build is used on purpose. |
| Changed `BIND` / `PORT` | `./scripts/server.sh init --rebind` (it restarts the app). |
| `pull-backups` asks for a sudo password in cron | Cron cannot answer it: give your server user passwordless sudo, or run it by hand. |
