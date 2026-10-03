#!/usr/bin/env sh
# Restore a backup made by scripts/backup.sh.   Usage: scripts/restore.sh <journal-STAMP.db> [uploads-STAMP.tar.gz]
# STOP THE APP FIRST (docker compose down). Use the db and uploads files with the same STAMP.
#
# - checks the backup (integrity_check) before touching anything
# - keeps the database it replaces as <DATA_DIR>/journal.db.pre-restore-<timestamp> (never overwrites an earlier copy)
# - deletes the old journal.db-wal / -shm (a stale WAL next to a restored DB corrupts it)
# - screenshots are merged into <DATA_DIR>/uploads (nothing existing is deleted)
# Env: DATA_DIR (default ./data). RESTORE_FORCE=1 skips the "app is running" refusal.
set -eu
cd "$(dirname "$0")/.."
DATA=${DATA_DIR:-./data}
DB="$DATA/journal.db"

die() { echo "restore failed: $*" >&2; exit 1; }
[ $# -ge 1 ] && [ $# -le 2 ] || die "usage: scripts/restore.sh <backup.db> [uploads.tar.gz]"
BACKUP=$1
UPLOADS=${2:-}
[ -s "$BACKUP" ] || die "backup file not found or empty: $BACKUP"
[ -z "$UPLOADS" ] || [ -s "$UPLOADS" ] || die "uploads archive not found or empty: $UPLOADS"
command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required (apt install sqlite3 / brew install sqlite)"

if [ "${RESTORE_FORCE:-}" != 1 ] && command -v docker >/dev/null 2>&1 \
  && [ -n "$(docker compose ps --status running -q journal 2>/dev/null || true)" ]; then
  die "the app is running. Stop it first (docker compose down), or set RESTORE_FORCE=1 if you know it is not using $DATA"
fi
echo "Restoring into $DATA (the app must not be running)."

# Validate the uploads archive before changing anything: only uploads/..., no absolute or parent paths.
if [ -n "$UPLOADS" ]; then
  tar -tzf "$UPLOADS" > /dev/null || die "cannot read $UPLOADS"
  if tar -tzf "$UPLOADS" | grep -Ev '^uploads(/|$)' | grep -q . || tar -tzf "$UPLOADS" | grep -Eq '(^|/)\.\.(/|$)'; then
    die "$UPLOADS contains paths outside uploads/"
  fi
fi

mkdir -p "$DATA"
TMP="$DATA/.restore-$$.db"
trap 'rm -f "$TMP" "$TMP-wal" "$TMP-shm"' EXIT
cp "$BACKUP" "$TMP"
[ "$(sqlite3 "$TMP" 'pragma integrity_check')" = "ok" ] || die "the backup failed its integrity check; nothing was changed"
rm -f "$TMP-wal" "$TMP-shm"

# Keep what we replace, under a unique name (an earlier .pre-restore copy is never overwritten). Fold its WAL into the
# file first, and move any -wal/-shm along with it so no committed frame is lost if that fails.
KEPT=
if [ -e "$DB" ]; then
  sqlite3 "$DB" 'pragma wal_checkpoint(truncate)' > /dev/null 2>&1 || true
  KEPT="$DB.pre-restore-$(date +%Y%m%d-%H%M%S)-$$"
  mv "$DB" "$KEPT"
  for ext in wal shm; do
    if [ -e "$DB-$ext" ]; then mv "$DB-$ext" "$KEPT-$ext"; fi
  done
  echo "Previous database kept as $KEPT"
fi
rm -f "$DB-wal" "$DB-shm" # stale ones, when there was no database to go with them
mv "$TMP" "$DB"

if [ "$(sqlite3 "$DB" 'pragma integrity_check')" != "ok" ]; then
  rm -f "$DB" "$DB-wal" "$DB-shm"
  if [ -n "$KEPT" ]; then
    mv "$KEPT" "$DB"
    for ext in wal shm; do
      if [ -e "$KEPT-$ext" ]; then mv "$KEPT-$ext" "$DB-$ext"; fi
    done
  fi
  die "integrity check of the restored database failed; the previous database was put back"
fi
rm -f "$DB-wal" "$DB-shm"

if [ -n "$UPLOADS" ]; then
  tar -xzf "$UPLOADS" -C "$DATA"
  echo "Screenshots restored from $UPLOADS"
else
  echo "No uploads archive given: screenshots were not touched."
fi
# The container's app user is uid 1000. (The container entrypoint also fixes ownership when it starts as root.)
if [ "$(id -u)" = 0 ]; then chown -R 1000:1000 "$DATA"; fi
echo "Restore complete. Start the app again (docker compose up -d, or systemctl start edge-journal)."
