#!/usr/bin/env sh
# Deploy and operate Edge Journal on your own Linux server over SSH (no Docker). Run it from the repo on your laptop:
#   ./scripts/server.sh --help        (or: npm run server -- --help)
# Plain POSIX sh (macOS bash 3.2 / Linux). Reads .deploy.env (see deploy/deploy.env.example). Secrets are typed here,
# generated here and sent over ssh STDIN only: never on a command line, never printed.
set -eu
cd "$(dirname "$0")/.."

INC=edge-journal-incoming # staging dir in the ssh user's home on the server

usage() {
  cat <<'EOF'
Usage: ./scripts/server.sh <command> [options]     (npm run server -- <command>)

First time:
  doctor                 Check the server (OS, sudo, Node, sqlite3, memory, disk, network, port) and say what to fix.
  init [options]         Prepare the server once (safe to repeat). Asks for the app password.
      --install-node       install Node 22 from NodeSource if it is missing
      --add-swap           add a 2 GB swapfile when RAM+swap < 2 GB (the build needs ~1.5 GB)
      --reset-password     ask for a new password (logs everyone out)
      --rotate-secret      make a new SESSION_SECRET (logs everyone out)
      --rebind             re-apply BIND / PORT from .deploy.env to the server config
Every day:
  deploy [options]       Ship the committed code (git archive HEAD), build it on the server, back up first, swap, check health;
                         rolls back automatically if the new version is not healthy.
      --skip-checks        do not run typecheck + tests locally first
      --allow-dirty        deploy HEAD even though the working tree has uncommitted changes (they are NOT shipped)
  status                 Release, service, health, last backup, disk, and warnings (old backup / no copy on this machine).
  logs [-n N] [-f]       Service log (journalctl).         health   One health request.
  tunnel                 SSH tunnel so http://localhost:PORT reaches the app (when it listens on 127.0.0.1 only).
Data safety:
  backup                 Make a backup on the server now.
  pull-backups [-n N]    Copy the newest N (default 7) backups to this machine (LOCAL_BACKUP_DIR). A backup that only
                         lives on the same server is not a backup: run this regularly.
  restore <backup.db> [uploads.tar.gz]   Put a backup on the server (also: move local data to the server).
  rollback               Go back to the previous release (and, if needed, offer to restore the pre-deploy backup).
EOF
}

die() { echo "error: $*" >&2; exit 1; }
note() { echo "==> $*"; }
cleanup() {
  stty echo 2>/dev/null || true
  [ -z "${TMPD:-}" ] || rm -rf "$TMPD"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

untilde() { case $1 in "~") echo "$HOME" ;; "~/"*) echo "$HOME/${1#"~/"}" ;; *) echo "$1" ;; esac; }

load_config() {
  SERVER='' SSH_PORT='' SSH_KEY='' BIND='' PORT='' LOCAL_BACKUP_DIR=''
  f=${DEPLOY_ENV:-.deploy.env}
  case $f in /*|./*) ;; *) f=./$f ;; esac
  [ -f "$f" ] || die "no .deploy.env here. Copy deploy/deploy.env.example to .deploy.env and set SERVER=user@host"
  # shellcheck disable=SC1090
  . "$f"
  [ -n "$SERVER" ] || die "SERVER is not set in .deploy.env"
  case $SERVER in -*|*[!A-Za-z0-9@._:-]*) die "SERVER must look like user@host (got: $SERVER)" ;; esac
  SSH_PORT=${SSH_PORT:-22}
  PORT=${PORT:-3000}
  BIND=${BIND:-}
  SSH_KEY=$(untilde "${SSH_KEY:-}")
  LOCAL_BACKUP_DIR=$(untilde "${LOCAL_BACKUP_DIR:-$HOME/edge-journal-backups}")
  case $SSH_PORT$PORT in *[!0-9]*) die "SSH_PORT and PORT must be numbers" ;; esac
  case $BIND in ''|127.0.0.1|0.0.0.0) ;; *[!0-9.]*|*..*) die "BIND must be 127.0.0.1, 0.0.0.0 or an IPv4 address" ;; esac
  # One ssh connection is reused for the several calls of a command, so a password is asked for once.
  CM_DIR=/tmp/ej-ssh-$(id -u)
  mkdir -p "$CM_DIR" && chmod 700 "$CM_DIR"
  CM_OPTS="-o ControlMaster=auto -o ControlPath=$CM_DIR/%C -o ControlPersist=60 -o ServerAliveInterval=30"
}

# ---- ssh plumbing (the only places that call ssh / scp) -----------------------------------------------------------
rssh() { ssh -p "$SSH_PORT" ${SSH_KEY:+-i "$SSH_KEY"} $CM_OPTS "$@"; }
rscp() { scp -P "$SSH_PORT" ${SSH_KEY:+-i "$SSH_KEY"} $CM_OPTS "$@"; }
run() { rssh -n "$SERVER" "$1"; }          # a command, no terminal, no stdin
run_t() { rssh -t "$SERVER" "$1"; }        # a command with a terminal (sudo may ask for a password; output streams)
run_in() { rssh "$SERVER" "$1"; }          # a command that reads our stdin

ssh_help() {
  echo "Cannot run commands on $SERVER. Check: SERVER / SSH_PORT / SSH_KEY in .deploy.env, that the server is on, and try by hand:" >&2
  echo "  ssh -p $SSH_PORT ${SSH_KEY:+-i $SSH_KEY }$SERVER" >&2
}

SUDO=sudo
detect_sudo() {
  uid=$(run 'id -u') || { ssh_help; exit 1; }
  uid=$(printf '%s' "$uid" | tr -d '\r')
  [ "$uid" != 0 ] || SUDO=
}

push_deploy() { # the server-side scripts, always the ones of this checkout
  run "umask 077 && mkdir -p $INC/deploy" || { ssh_help; exit 1; }
  rscp deploy/lib.sh deploy/remote-deploy.sh deploy/remote-admin.sh deploy/server-setup.sh deploy/doctor.sh \
    deploy/edge-journal.service deploy/edge-journal-backup.service deploy/edge-journal-backup.timer \
    "$SERVER:$INC/deploy/" > /dev/null || die "could not copy the deploy scripts to $SERVER"
}
admin() { run_t "$SUDO sh $INC/deploy/remote-admin.sh $1"; } # runs remote-admin.sh with sudo; its exit code is returned

ask() { printf '%s' "$1" >&2; read -r REPLY || die "no input (is this running without a terminal?)"; }
ask_secret() {
  printf '%s' "$1" >&2
  stty -echo 2>/dev/null || true
  read -r REPLY || { stty echo 2>/dev/null || true; die "no input"; }
  stty echo 2>/dev/null || true
  echo >&2
}
confirm_typed() { # confirm_typed <explanation>
  printf '%s\n\nType RESTORE to continue (anything else cancels): ' "$1" >&2
  read -r REPLY || die "no input"
  [ "$REPLY" = RESTORE ] || die "cancelled; nothing was changed"
}
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; }
human() { awk -v b="$1" 'BEGIN { if (b >= 1073741824) printf "%.1f GB", b/1073741824; else if (b >= 1048576) printf "%.1f MB", b/1048576; else printf "%.0f KB", b/1024 }'; }

# ---- commands -----------------------------------------------------------------------------------------------------------
cmd_doctor() {
  load_config
  echo "Checking $SERVER (nothing is changed)..."
  echo
  rc=0
  run_in "sh -s -- $PORT" < deploy/doctor.sh || rc=$?
  if [ "$rc" != 0 ]; then ssh_help; exit 1; fi
}

random_hex() { openssl rand -hex 32 2>/dev/null || od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }

ask_password() { # sets PW (hidden input, typed twice)
  tries=0
  while :; do
    ask_secret "App password (min. 10 characters; you log in with it): "
    PW=$REPLY
    ask_secret "Type it again: "
    if [ "$REPLY" != "$PW" ]; then echo "The two entries differ." >&2
    elif [ "${#PW}" -lt 10 ]; then echo "Too short: use at least 10 characters." >&2
    else
      case $PW in
        *'"'*|*"'"*|*'\'*|*'`'*|' '*|*' ') echo 'Please avoid  " '"'"' \ `  and leading/trailing spaces (they break the server config file).' >&2 ;;
        *) return 0 ;;
      esac
    fi
    tries=$((tries + 1))
    [ "$tries" -lt 3 ] || die "giving up after 3 tries"
  done
}

choose_bind() { # sets BIND (from .deploy.env, or asks)
  [ -z "$BIND" ] || return 0
  echo "Where should the app listen on the server?" >&2
  echo "  1) 127.0.0.1 only: reach it with './scripts/server.sh tunnel' (recommended)" >&2
  echo "  2) all interfaces: reachable by IP from your private network / LAN / VPN ONLY. The password travels over plain HTTP." >&2
  ask "Choose 1 or 2 [1]: "
  case ${REPLY:-1} in 1|'') BIND=127.0.0.1 ;; 2) BIND=0.0.0.0 ;; *) die "please answer 1 or 2" ;; esac
  echo "(Put BIND=$BIND in .deploy.env to skip this question next time.)" >&2
}

cmd_init() {
  node_flag='' swap_flag='' reset_pw=0 rotate=0 rebind=0
  while [ $# -gt 0 ]; do
    case $1 in
      --install-node) node_flag=' --install-node' ;;
      --add-swap) swap_flag=' --add-swap' ;;
      --reset-password) reset_pw=1 ;;
      --rotate-secret) rotate=1 ;;
      --rebind) rebind=1 ;;
      *) die "unknown option for init: $1 (see --help)" ;;
    esac
    shift
  done
  load_config
  detect_sudo
  exists=$(run 'test -e /etc/edge-journal/edge-journal.env && echo yes || echo no' | tr -d '\r')
  need_pw=$reset_pw need_secret=$rotate need_bind=$rebind
  if [ "$exists" = no ]; then need_pw=1 need_secret=1 need_bind=1
  else echo "A server config already exists: your password and SESSION_SECRET stay as they are unless you pass --reset-password / --rotate-secret."; fi
  [ "$reset_pw" = 0 ] && [ "$rotate" = 0 ] || echo "Note: this logs out every browser session."

  content=''
  if [ "$need_pw" = 1 ]; then ask_password; content="APP_PASSWORD=\"$PW\""; PW=''; fi
  if [ "$need_secret" = 1 ]; then content="$content
SESSION_SECRET=$(random_hex)"; fi
  if [ "$need_bind" = 1 ]; then
    choose_bind
    cookie=true
    [ "$BIND" = 127.0.0.1 ] || cookie=false
    content="$content
HOST=$BIND
PORT=$PORT
COOKIE_SECURE=$cookie"
  fi

  push_deploy
  stage_arg=''
  if [ -n "$content" ]; then
    # the settings travel over ssh stdin into a 0600 file that the server script moves into place and deletes
    printf '%s\n' "$content" | run_in "umask 077 && mkdir -p $INC && cat > $INC/env.new" || die "could not stage the settings"
    content=''
    stage_arg=" --env-stage $INC/env.new"
  fi
  rc=0
  admin_setup="$SUDO sh $INC/deploy/server-setup.sh$node_flag$swap_flag$stage_arg"
  run_t "$admin_setup" || rc=$?
  run "rm -f $INC/env.new" || true
  [ "$rc" = 0 ] || die "server setup did not finish (exit $rc); nothing is half-installed that a re-run cannot fix"

  echo
  echo "Server prepared. Next: ./scripts/server.sh deploy"
  if [ "$BIND" != 127.0.0.1 ] && [ -n "$BIND" ]; then
    ip=$(run 'echo ${SSH_CLIENT%% *}' | tr -d '\r') || ip=''
    echo
    echo "Firewall (the app listens on $BIND: only your private network should reach port $PORT). With ufw, on the server:"
    echo "  sudo ufw allow OpenSSH            # first, or enabling ufw locks you out"
    echo "  sudo ufw allow from ${ip:-<your IP>} to any port $PORT proto tcp"
    echo "  sudo ufw enable"
  fi
}

cmd_deploy() {
  skip=0 dirty=0
  while [ $# -gt 0 ]; do
    case $1 in
      --skip-checks) skip=1 ;;
      --allow-dirty) dirty=1 ;;
      *) die "unknown option for deploy: $1 (see --help)" ;;
    esac
    shift
  done
  load_config
  command -v git >/dev/null 2>&1 && git rev-parse --verify -q HEAD >/dev/null || die "this must run inside the git checkout, with at least one commit"
  if [ -n "$(git status --porcelain)" ]; then
    if [ "$dirty" = 1 ]; then echo "warning: uncommitted changes are NOT deployed; only the committed HEAD ($(git rev-parse --short HEAD)) is shipped."
    else
      git status --short | head -n 15
      die "the working tree has uncommitted changes. Deploys ship 'git archive HEAD', so commit them first (or use --allow-dirty to deploy HEAD without them)."
    fi
  fi
  if [ "$skip" = 0 ]; then
    note "local checks: typecheck + tests (the server builds the app itself; use --skip-checks to bypass)"
    npm run typecheck && npm test || die "local checks failed; nothing was deployed"
  fi

  id=$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)
  TMPD=$(mktemp -d "${TMPDIR:-/tmp}/ej-deploy.XXXXXX")
  git archive --format=tar HEAD | gzip -c > "$TMPD/release-$id.tar.gz"
  tar -tzf "$TMPD/release-$id.tar.gz" | grep -q '^package.json$' || die "git archive produced no usable tarball"
  {
    echo "commit=$(git rev-parse HEAD)"
    echo "describe=$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)"
    echo "date=$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo "id=$id"
  } > "$TMPD/release-$id.RELEASE" # shipped next to the tarball (not appended to it: plain git archive output extracts cleanly everywhere)
  note "release $id ($(human "$(wc -c < "$TMPD/release-$id.tar.gz")"))"

  detect_sudo
  push_deploy
  rscp "$TMPD/release-$id.tar.gz" "$TMPD/release-$id.RELEASE" "$SERVER:$INC/" > /dev/null || die "could not copy the release to $SERVER"
  note "building on the server; keep this terminal open (a first build takes a few minutes)"
  rc=0
  run_t "$SUDO sh $INC/deploy/remote-deploy.sh $id $INC/release-$id.tar.gz" || rc=$?
  echo
  case $rc in
    0)
      echo "Deployed $id."
      case ${BIND:-127.0.0.1} in 127.0.0.1) echo "Open it: ./scripts/server.sh tunnel, then http://localhost:$PORT" ;; *) echo "Open it: http://<server ip>:$PORT" ;; esac
      echo "If something looks wrong: ./scripts/server.sh rollback    Backups: ./scripts/server.sh status | pull-backups"
      ;;
    1) echo "The deploy failed before anything live changed; the app still runs the previous release." >&2 ;;
    2) echo "The new release was not healthy and the server went back to the previous code. Your data was not changed." >&2 ;;
    3) echo "The new release failed, the previous code could not read the database it had migrated, so the pre-deploy backup was restored. Everything is kept; read the messages above." >&2 ;;
    4) echo "FAILED and the app is NOT healthy. All copies are intact (messages above). Run: ./scripts/server.sh logs   then   ./scripts/server.sh restore <backup>" >&2 ;;
    6) echo "The first deploy failed (nothing to roll back to, no data at risk). Run: ./scripts/server.sh logs" >&2 ;;
    *) echo "The connection or the remote script ended unexpectedly (exit $rc). The server may have finished on its own: ./scripts/server.sh status (log: /var/log/edge-journal-deploy.log on the server)." >&2 ;;
  esac
  exit "$rc"
}

cmd_status() {
  load_config
  detect_sudo
  push_deploy
  rc=0
  admin status || rc=$?
  d=$LOCAL_BACKUP_DIR
  last=$(ls -1 "$d"/journal-*.db 2>/dev/null | sort | tail -n 1 || true)
  if [ -z "$last" ]; then
    echo "off-site: no copy on this machine yet"
    echo "WARN: all your backups live on the server only. Run ./scripts/server.sh pull-backups (see docs/deployment.md to automate it)."
  else
    age_d=$(( ($(date +%s) - $(mtime "$last")) / 86400 ))
    echo "off-site: $(basename "$last") in $d (${age_d} days old)"
    [ "$age_d" -le 7 ] || echo "WARN: your newest copy on this machine is $age_d days old. Run ./scripts/server.sh pull-backups"
  fi
  exit "$rc"
}

cmd_logs() {
  n=100 follow=''
  while [ $# -gt 0 ]; do
    case $1 in
      -n) shift; n=${1:-}; case $n in ''|*[!0-9]*) die "-n needs a number" ;; esac ;;
      -f) follow=' -f' ;;
      *) die "unknown option for logs: $1" ;;
    esac
    shift
  done
  load_config
  detect_sudo
  run_t "$SUDO journalctl -u edge-journal -n $n --no-pager$follow"
}

cmd_health() {
  load_config
  run "curl -fsS --max-time 5 http://127.0.0.1:$PORT/api/health" || { echo "not healthy (see: ./scripts/server.sh logs)" >&2; exit 1; }
  echo
}

cmd_tunnel() {
  load_config
  CM_OPTS='' # a tunnel must own its connection
  echo "Tunnel open. Browse to http://localhost:$PORT (Ctrl+C closes it). Use Chrome or Firefox: Safari refuses the Secure cookie on http://localhost."
  rssh -N -o ExitOnForwardFailure=yes -L "$PORT:127.0.0.1:$PORT" "$SERVER"
}

cmd_backup() {
  load_config
  detect_sudo
  push_deploy
  admin backup
}

cmd_pull_backups() {
  n=7
  while [ $# -gt 0 ]; do
    case $1 in
      -n) shift; n=${1:-}; case $n in ''|*[!0-9]*|0) die "-n needs a positive number" ;; esac ;;
      *) die "unknown option for pull-backups: $1" ;;
    esac
    shift
  done
  load_config
  detect_sudo
  push_deploy
  stamp=$(date +%Y%m%d-%H%M%S)
  staged=$INC/pull-$stamp.tar
  rc=0
  admin "stage-backups $n $staged" || rc=$?
  [ "$rc" = 0 ] || { run "rm -f $staged" || true; die "the server could not stage the backups (see the message above)"; }
  TMPD=$(mktemp -d "${TMPDIR:-/tmp}/ej-pull.XXXXXX")
  if ! rscp "$SERVER:$staged" "$TMPD/pull.tar" > /dev/null; then run "rm -f $staged" || true; die "could not download the backups"; fi
  run "rm -f $staged" || echo "warning: could not delete $staged on the server; remove it by hand" >&2
  # only plain file names, nothing that could write outside the target directory
  if tar -tf "$TMPD/pull.tar" | grep -Evq '^(journal-[0-9A-Za-z-]+\.db|uploads-[0-9A-Za-z-]+\.tar\.gz)$'; then
    tar -tf "$TMPD/pull.tar" | grep -Ev '^(journal-[0-9A-Za-z-]+\.db|uploads-[0-9A-Za-z-]+\.tar\.gz)$' | head -n 3 >&2
    die "unexpected file names in the downloaded archive; nothing was unpacked"
  fi
  mkdir -p "$LOCAL_BACKUP_DIR"
  chmod 700 "$LOCAL_BACKUP_DIR"
  (umask 077 && tar -xf "$TMPD/pull.tar" -C "$LOCAL_BACKUP_DIR")
  bad=0
  if command -v sqlite3 >/dev/null 2>&1; then
    for f in $(tar -tf "$TMPD/pull.tar" | grep '\.db$'); do
      if [ "$(sqlite3 -readonly "$LOCAL_BACKUP_DIR/$f" 'pragma integrity_check' | tail -n 1)" = ok ]; then echo "verified: $f"
      else echo "ERROR: $f failed its integrity check on this machine; copy it again" >&2; bad=1; fi
    done
  else echo "note: no local sqlite3, so the copies were not integrity-checked here (the server checked them when it made them)"; fi
  echo "Copied to $LOCAL_BACKUP_DIR: $(tar -tf "$TMPD/pull.tar" | tr '\n' ' ')"
  echo "Old copies here are never deleted automatically; remove ones you no longer need."
  echo
  echo "A backup that only exists on the same machine is not a backup. To pull one every night at 04:00 (needs an ssh key without"
  echo "a passphrase or a running agent, AND passwordless sudo for $SERVER), add this with 'crontab -e':"
  echo "  0 4 * * * cd $(pwd) && ./scripts/server.sh pull-backups >> $LOCAL_BACKUP_DIR/pull.log 2>&1"
  echo "On macOS cron may need Full Disk Access; a launchd agent with the same command works too (docs/deployment.md)."
  exit "$bad"
}

cmd_restore() {
  [ $# -ge 1 ] && [ $# -le 2 ] || die "usage: ./scripts/server.sh restore <backup.db> [uploads.tar.gz]"
  db=$1
  up=${2:-}
  [ -s "$db" ] || die "backup file not found or empty: $db"
  [ -z "$up" ] || [ -s "$up" ] || die "uploads archive not found or empty: $up"
  case $db in *.db) ;; *) die "$db does not look like a .db file" ;; esac
  [ ! -e "$db-wal" ] || die "$db has a -wal file next to it: copying only the .db would lose recent data. Make a consistent copy first: sqlite3 $db \".backup 'copy.db'\""
  if command -v sqlite3 >/dev/null 2>&1; then
    [ "$(sqlite3 -readonly "$db" 'pragma integrity_check' | tail -n 1)" = ok ] || die "$db failed its integrity check; nothing was done"
  fi
  if [ -n "$up" ]; then
    tar -tzf "$up" | grep -q '^uploads/' || die "$up must be a tar.gz holding an uploads/ folder (made with: tar -czf uploads.tar.gz -C <data dir> uploads)"
  fi
  load_config
  confirm_typed "This replaces the journal on $SERVER with $db${up:+ and merges the screenshots from $up}.
The app is stopped for a few seconds. The database it replaces is KEPT on the server as journal.db.pre-restore-<time>
(nothing is deleted), and a failed restore puts it back."
  detect_sudo
  push_deploy
  stamp=$(date +%Y%m%d-%H%M%S)
  rdir=$INC/restore-$stamp
  run "umask 077 && mkdir -p $rdir" || die "cannot reach the server"
  rscp "$db" "$SERVER:$rdir/journal.db" > /dev/null || die "upload failed"
  [ -z "$up" ] || rscp "$up" "$SERVER:$rdir/uploads.tar.gz" > /dev/null || die "upload failed"
  rc=0
  admin "restore $rdir/journal.db${up:+ $rdir/uploads.tar.gz}" || rc=$?
  run "rm -rf $rdir" || true
  exit "$rc"
}

cmd_rollback() {
  load_config
  detect_sudo
  push_deploy
  rc=0
  admin rollback || rc=$?
  if [ "$rc" = 5 ]; then
    echo >&2
    confirm_typed "The previous code runs but cannot use the current database (the newer release migrated it).
You can restore the newest pre-deploy backup (named above). That LOSES everything written since that backup, but the
database as it is now is kept on the server as journal.db.pre-restore-<time>. Nothing is deleted either way."
    rc=0
    admin restore-predeploy || rc=$?
  fi
  exit "$rc"
}

# ---- dispatch -------------------------------------------------------------------------------------------------------------
cmd=${1:-}
[ $# -eq 0 ] || shift
case $cmd in
  ''|-h|--help|help) usage ;;
  doctor) cmd_doctor "$@" ;;
  init) cmd_init "$@" ;;
  deploy) cmd_deploy "$@" ;;
  status) cmd_status "$@" ;;
  logs) cmd_logs "$@" ;;
  health) cmd_health "$@" ;;
  tunnel) cmd_tunnel "$@" ;;
  backup) cmd_backup "$@" ;;
  pull-backups) cmd_pull_backups "$@" ;;
  restore) cmd_restore "$@" ;;
  rollback) cmd_rollback "$@" ;;
  *) echo "unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
