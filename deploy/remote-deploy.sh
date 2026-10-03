#!/bin/sh
# Server side of `scripts/server.sh deploy` (runs as root, through sudo). POSIX sh.
# Usage: remote-deploy.sh <release-id> <release.tar.gz>
#
# Order, and why:
#  1. lock                         two deploys must never overlap
#  2. extract + npm ci + build     all in a NEW release dir as the service user; the running app is not touched
#  3. verified pre-deploy backup   DB + uploads; abort the whole deploy if it fails (skipped only on the very first deploy)
#  4. atomic symlink swap + restart, then wait for /api/health (the first request opens the DB and runs the migrations)
#  5. unhealthy -> switch back to the previous release; if that cannot run on the (migrated) DB either -> restore the
#     pre-deploy backup. Nothing is ever deleted: the replaced DB stays as journal.db.pre-restore-*.
# Exit codes: 0 deployed | 1 failed before anything live changed | 2 new release failed, rolled back to the previous code
#             3 rolled back AND the DB restored from the pre-deploy backup | 4 FAILED and the app is not running healthy
#             6 first deploy failed (nothing to roll back to; the app is not running)
set -eu
umask 022
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/lib.sh"

ID=${1:-}
TARBALL=${2:-}
[ -n "$ID" ] && [ -f "$TARBALL" ] || { echo "usage: remote-deploy.sh <release-id> <release.tar.gz>" >&2; exit 1; }
case $ID in *[!A-Za-z0-9._-]*) echo "bad release id: $ID" >&2; exit 1 ;; esac
TARBALL=$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")
need_root

lock
REL=$RELEASES/$ID
SIDE=${TARBALL%.tar.gz}.RELEASE # commit / date info the laptop ships next to the tarball
cleanup() {
  rm -f "$TARBALL" "$SIDE"
  unlock
}
trap cleanup EXIT
trap 'exit 130' INT TERM
trap '' HUP # a dropped ssh connection must not kill a deploy half way: the script finishes (or rolls back) on its own

fail_early() { # nothing live was touched: drop the half-built release
  log "ERROR: $*"
  rm -rf "$REL"
  log "Nothing live was changed. The app keeps running the previous release."
  exit 1
}

# ---- preflight ----------------------------------------------------------------------------------------------------
log "deploy $ID: preflight"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing. Run './scripts/server.sh init' first."
[ "$NO_ROOT" = 1 ] || id "$SVC_USER" >/dev/null 2>&1 || die "user $SVC_USER does not exist. Run './scripts/server.sh init' first."
command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is not installed (backups need it): sudo apt-get install -y sqlite3"
node_major=$($NODE_BIN -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$node_major" -ge 22 ] || die "Node 22 or newer is required (found: $($NODE_BIN -v 2>/dev/null || echo none)). Run './scripts/server.sh init --install-node'."
[ ! -e "$REL" ] || die "release $ID already exists"
mkdir -p "$RELEASES" "$APP/.home"
own "$SVC_USER:$SVC_USER" "$APP/.home"
chmod 700 "$APP/.home"
free_mb=$(df -Pk "$APP" | awk 'NR==2 { print int($4 / 1024) }')
[ "$free_mb" -ge "${MIN_DISK_MB:-1500}" ] || die "only ${free_mb} MB free on the disk holding $APP; building needs about ${MIN_DISK_MB:-1500} MB. Free some space (old releases are pruned automatically)."
MEMINFO=${MEMINFO:-/proc/meminfo}
if [ -r "$MEMINFO" ]; then
  mem_mb=$(awk '/^(MemTotal|SwapTotal):/ { kb += $2 } END { print int(kb / 1024) }' "$MEMINFO")
  [ "$mem_mb" -ge "${MIN_MEM_MB:-1024}" ] || die "only ${mem_mb} MB of RAM+swap: 'next build' will be killed. Add swap: ./scripts/server.sh init --add-swap"
  [ "$mem_mb" -ge 1500 ] || log "warning: only ${mem_mb} MB of RAM+swap; the build may be slow or fail. Consider: ./scripts/server.sh init --add-swap"
fi
PREV=$(current_id)

# ---- extract + build, as the service user, in the new release dir ---------------------------------------------------
log "deploy $ID: extracting"
mkdir "$REL"
tar -xzf "$TARBALL" -C "$REL" || fail_early "could not extract $TARBALL"
[ -f "$REL/package.json" ] && [ -f "$REL/scripts/backup.sh" ] && [ -f "$REL/scripts/restore.sh" ] || fail_early "the archive does not look like an Edge Journal release (package.json or scripts/backup.sh / restore.sh missing)"
[ ! -f "$SIDE" ] || cp "$SIDE" "$REL/RELEASE"
own -R "$SVC_USER:$SVC_USER" "$REL"

# The build gets a throwaway DATA_DIR and no secrets: it must never be able to open (and migrate) the live database.
in_release() { (cd "$REL" && as_svc env HOME="$APP/.home" NODE_OPTIONS=--max-old-space-size=1536 NEXT_TELEMETRY_DISABLED=1 CI=1 DATA_DIR="$REL/.build-data" "$@"); }
log "deploy $ID: npm ci (a few minutes the first time)"
in_release $NPM ci --no-audit --no-fund --fetch-retries=6 || fail_early "npm ci failed (network? build tools? see the output above; better-sqlite3 needs a prebuilt binary download or build-essential + python3)"
log "deploy $ID: npm run build"
in_release $NPM run build || fail_early "the build failed (if the output says 'Killed' the server ran out of memory: ./scripts/server.sh init --add-swap)"
in_release $NPM prune --omit=dev --no-audit --no-fund || fail_early "npm prune failed"
rm -rf "$REL/.build-data"
own -R root:root "$REL" 2>/dev/null || true
chmod -R go+rX "$REL"
mkdir -p "$REL/.next/cache" # the only place next start may write
own "$SVC_USER:$SVC_USER" "$REL/.next/cache"

# ---- verified pre-deploy backup --------------------------------------------------------------------------------------
BK_NOTE="none (first deploy: there is no database yet)"
PRE_DB=
if [ -s "$DATA/journal.db" ]; then
  log "deploy $ID: taking a verified pre-deploy backup"
  take_backup "$PREDEPLOY" "$REL" "${KEEP_PREDEPLOY:-10}" || fail_early "the pre-deploy backup failed or did not verify, so the deploy was aborted"
  PRE_DB=$BK_DB
  BK_NOTE="$BK_DB${BK_UP:+ and $BK_UP}"
else
  log "deploy $ID: no database yet (first deploy): nothing to back up"
fi

# ---- swap, restart, wait for health -----------------------------------------------------------------------------------
log "deploy $ID: switching to the new release and restarting (previous: ${PREV:-none})"
swap_link "$ID"
if svc_restart && wait_healthy "$HEALTH_TIMEOUT"; then
  :
else
  log "ERROR: the new release did not become healthy. Service log:"
  show_service_log
  if [ -z "$PREV" ] || [ ! -d "$RELEASES/$PREV" ]; then
    log "FIRST DEPLOY FAILED: there is no earlier release to go back to and no data was at risk. Fix the problem (see the log above, 'logs' command), then deploy again."
    exit 6
  fi
  log "rolling back to the previous release $PREV"
  swap_link "$PREV"
  svc_restart || true
  if wait_healthy 60; then
    rm -rf "$REL" # the failed build; the service log above says why it failed
    log "ROLLED BACK: $PREV is running again and the database was not touched. The pre-deploy backup stays in ${PRE_DB:-n/a (first deploy)}."
    exit 2
  fi
  log "the previous release cannot run on the current database either (most likely the new version migrated it). Restoring the pre-deploy backup."
  if [ -z "$PRE_DB" ]; then
    log "FAILED: no pre-deploy backup exists and the app is not healthy. Look at the service log: ./scripts/server.sh logs"
    exit 4
  fi
  svc_stop || true
  if restore_db "$REL/scripts/restore.sh" "$PRE_DB"; then
    svc_start || true
    if wait_healthy 60; then
      rm -rf "$REL"
      log "ROLLED BACK AND RESTORED: $PREV is running on the database from before the deploy ($PRE_DB)."
      log "Anything written between the backup and now is NOT in that database. Nothing was deleted: the database as the failed release left it is $DATA/journal.db.pre-restore-* (with its -wal/-shm), and the app's own copies are in $DATA/backups/pre-migrate-*.db."
      exit 3
    fi
  fi
  svc_start || true
  log "FAILED: the app is NOT healthy. Every copy is intact: backup $PRE_DB, the previous database $DATA/journal.db.pre-restore-*, pre-migrate copies in $DATA/backups/. Next step: ./scripts/server.sh logs, then ./scripts/server.sh restore <backup>."
  exit 4
fi

# ---- success ------------------------------------------------------------------------------------------------------------
log "deploy $ID: healthy. Pruning old releases (keeping $KEEP_RELEASES newest and the current one)"
cur=$(current_id)
n=0
for r in $(ls -1 "$RELEASES" | sort -r); do
  case $r in ''|.|..|*/*) continue ;; esac
  [ -d "$RELEASES/$r" ] || continue
  n=$((n + 1))
  { [ "$r" = "$cur" ] || [ "$n" -le "$KEEP_RELEASES" ]; } && continue
  log "removing old release $r"
  rm -rf "${RELEASES:?}/$r"
done
commit=$(sed -n 's/^commit=//p' "$REL/RELEASE" 2>/dev/null | head -n 1 || true)
echo
echo "================ DEPLOYED ================"
echo "release : $ID"
echo "commit  : ${commit:-unknown}"
echo "backup  : $BK_NOTE"
echo "health  : 200 OK at $(health_url)"
echo "previous: ${PREV:-none} (kept; './scripts/server.sh rollback' switches back)"
echo "log     : $LOG_FILE"
