# Shared helpers for the server-side scripts (remote-deploy.sh, remote-admin.sh). Sourced, never run on its own.
# Everything is overridable by environment variables so the tests can run it in a temp dir without root or systemd:
#   ROOT (path prefix), NO_ROOT=1 (skip the root check and every chown), SYSTEMCTL, RUNUSER (command prefix that runs
#   something as the service user; empty = run as the current user), NPM, CURL, JOURNALCTL, HEALTH_URL, HEALTH_TIMEOUT.

ROOT=${ROOT:-}
APP=$ROOT/opt/edge-journal
RELEASES=$APP/releases
CURRENT=$APP/current
DATA=${DATA_DIR:-$ROOT/var/lib/edge-journal}
BACKUPS=${BACKUP_DIR:-$ROOT/var/backups/edge-journal}
PREDEPLOY=$BACKUPS/pre-deploy
ENV_FILE=${ENV_FILE:-$ROOT/etc/edge-journal/edge-journal.env}
LOG_FILE=${LOG_FILE:-$ROOT/var/log/edge-journal-deploy.log}
SVC=${SVC_NAME:-edge-journal}
SVC_USER=${SVC_USER:-edge-journal}
SYSTEMCTL=${SYSTEMCTL:-systemctl}
JOURNALCTL=${JOURNALCTL:-journalctl}
RUNUSER=${RUNUSER-runuser -u $SVC_USER --}
NPM=${NPM:-npm}
CURL=${CURL:-curl}
NODE_BIN=${NODE_BIN:-node}
NO_ROOT=${NO_ROOT:-0}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-90}
HEALTH_INTERVAL=${HEALTH_INTERVAL:-2}
FAST_FAIL_503=${FAST_FAIL_503:-5} # this many 503s in a row = the app is up but cannot use the database: no point waiting
KEEP_RELEASES=${KEEP_RELEASES:-2}

log() {
  echo "$*" || true # the terminal may be gone (dropped ssh connection): keep going
  { mkdir -p "$(dirname "$LOG_FILE")" && echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG_FILE"; } 2>/dev/null || true
  if [ "$NO_ROOT" != 1 ] && command -v logger >/dev/null 2>&1; then logger -t edge-journal-deploy -- "$*" || true; fi
}
die() { log "ERROR: $*"; exit 1; }

as_svc() { $RUNUSER "$@"; } # RUNUSER is split on purpose ("runuser -u edge-journal --")
own() { [ "$NO_ROOT" = 1 ] || chown "$@"; }
need_root() { [ "$NO_ROOT" = 1 ] || [ "$(id -u)" = 0 ] || die "this must run as root (the laptop script calls it through sudo)"; }

env_get() { [ -r "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '"' || true; }
health_url() {
  if [ -n "${HEALTH_URL:-}" ]; then echo "$HEALTH_URL"; return; fi
  p=$(env_get PORT)
  echo "http://127.0.0.1:${p:-3000}/api/health"
}

# One deploy / restore / rollback at a time. A symlink is the lock: creating it is atomic and its target is our pid.
LOCK=$APP/.lock
lock() {
  mkdir -p "$APP"
  if ! ln -s "$$" "$LOCK" 2>/dev/null; then
    other=$(readlink "$LOCK" 2>/dev/null || true)
    if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
      die "another deploy or restore is running (pid $other). Wait for it to finish."
    fi
    log "removing a stale lock (pid ${other:-unknown} is gone)"
    rm -f "$LOCK"
    ln -s "$$" "$LOCK" 2>/dev/null || die "could not take the lock $LOCK"
  fi
  HAVE_LOCK=1
}
unlock() { if [ "${HAVE_LOCK:-0}" = 1 ] && [ "$(readlink "$LOCK" 2>/dev/null || true)" = "$$" ]; then rm -f "$LOCK"; fi; }

svc_stop() { $SYSTEMCTL stop "$SVC"; }
svc_start() { $SYSTEMCTL start "$SVC"; }
svc_restart() { $SYSTEMCTL restart "$SVC"; }
show_service_log() { $JOURNALCTL -u "$SVC" -n 25 --no-pager 2>/dev/null || true; }

# wait_healthy <seconds>: 0 as soon as /api/health answers 200. The app opens (and migrates) the DB on that first request,
# so a 200 means the migrations ran. FAST_FAIL_503 answers of 503 in a row mean "up, but the database is unusable".
wait_healthy() {
  deadline=$(($(date +%s) + $1))
  bad=0
  while :; do
    code=$($CURL -s -o /dev/null -w '%{http_code}' --max-time 5 "$(health_url)" 2>/dev/null) || code=000
    [ "$code" = 200 ] && return 0
    if [ "$code" = 503 ]; then bad=$((bad + 1)); else bad=0; fi
    [ "$bad" -ge "$FAST_FAIL_503" ] && return 1
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep "$HEALTH_INTERVAL" # whole seconds are fine; the tests use fractions
  done
}

# Point `current` at releases/<id>. mv -T makes the swap atomic on Linux; where it does not exist (macOS, in the tests)
# the link is removed first, which is fine because the service is restarted right afterwards.
swap_link() {
  [ -L "$CURRENT" ] || [ ! -e "$CURRENT" ] || die "$CURRENT exists and is not a symlink; refusing to replace it"
  tmp=$APP/.current.new
  rm -f "$tmp"
  ln -s "releases/$1" "$tmp"
  mv -T "$tmp" "$CURRENT" 2>/dev/null && return 0
  rm -f "$CURRENT"
  mv "$tmp" "$CURRENT"
}
current_id() { [ -L "$CURRENT" ] && basename "$(readlink "$CURRENT")" || true; }

# take_backup <outdir> <release dir whose scripts/backup.sh to use> [keep]: DB + uploads as the service user (never as root: root
# would create root-owned -wal/-shm files next to the live DB). Sets BK_DB / BK_UP / BK_STAMP; returns 1 on any problem.
take_backup() {
  mkdir -p "$1"
  own "$SVC_USER:$SVC_USER" "$1"
  chmod 700 "$1"
  bk_out=$(as_svc env DATA_DIR="$DATA" BACKUP_DIR="$1" BACKUP_KEEP="${3:-30}" sh "$2/scripts/backup.sh" 2>&1) || { echo "$bk_out"; return 1; }
  echo "$bk_out"
  BK_STAMP=$(printf '%s\n' "$bk_out" | sed -n 's/^Backup written to .* (\([^)]*\))$/\1/p' | tail -n 1)
  [ -n "$BK_STAMP" ] || return 1
  BK_DB=$1/journal-$BK_STAMP.db
  BK_UP=$1/uploads-$BK_STAMP.tar.gz
  [ -s "$BK_DB" ] || return 1
  [ "$(sqlite3 -readonly "$BK_DB" 'pragma integrity_check' | tail -n 1)" = ok ] || return 1
  [ -e "$BK_UP" ] || BK_UP=
}

# restore_db <restore.sh> <backup.db> [uploads.tar.gz]: the service must be stopped. Runs scripts/restore.sh as the service
# user (integrity check first, the replaced DB kept as journal.db.pre-restore-*, stale -wal/-shm removed, rollback on failure).
# When screenshots are restored too, the current uploads are archived first (restore.sh itself only ever adds files).
restore_db() {
  rs=$1
  rdb=$2
  rup=${3:-}
  if [ -n "$rup" ] && [ -d "$DATA/uploads" ]; then
    as_svc tar -czf "$DATA/uploads.pre-restore-$(date +%Y%m%d-%H%M%S)-$$.tar.gz" -C "$DATA" uploads
  fi
  as_svc env DATA_DIR="$DATA" RESTORE_FORCE=1 sh "$rs" "$rdb" ${rup:+"$rup"}
}

human() { awk -v b="$1" 'BEGIN { if (b >= 1073741824) printf "%.1f GB", b/1073741824; else if (b >= 1048576) printf "%.1f MB", b/1048576; else printf "%.0f KB", b/1024 }'; }
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; } # GNU, then BSD
