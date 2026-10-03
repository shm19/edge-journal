#!/usr/bin/env sh
# Consistent online backup of the journal: the database AND the screenshots. Keeps the last 30 of each.
# Cron example (daily 03:00):  0 3 * * * /path/to/edge-journal/scripts/backup.sh >> /path/to/edge-journal/backups/cron.log 2>&1
#
# Env: DATA_DIR   data dir on the HOST (default ./data); BACKUP_DIR   where backups go (default ./backups);
#      BACKUP_KEEP how many of each to keep (default 30)
# With host `sqlite3` it reads DATA_DIR directly (run as the user that owns it, or root). Without it, it
# runs sqlite3 and tar inside the running `journal` container (compose service), whose data dir is /data.
# Backups on the same disk are not off-site backups: copy BACKUP_DIR to another machine as well.
set -eu
umask 077
cd "$(dirname "$0")/.."
DATA=${DATA_DIR:-./data}
OUT=${BACKUP_DIR:-./backups}
STAMP=$(date +%Y%m%d-%H%M%S)-$$
CDATA=/data # DATA_DIR inside the container (docker-compose.yml)
KEEP=${BACKUP_KEEP:-30}

die() { echo "backup failed: $*" >&2; exit 1; }
case $KEEP in ''|*[!0-9]*|0) die "BACKUP_KEEP must be a positive number" ;; esac
case "$OUT$DATA" in *\"*) die 'DATA_DIR / BACKUP_DIR must not contain a double quote' ;; esac

mkdir -p "$OUT"
DB_TMP="$OUT/.journal-$STAMP.db.tmp"
UP_TMP="$OUT/.uploads-$STAMP.tar.gz.tmp"
cleanup() {
  rm -f "$DB_TMP" "$DB_TMP-wal" "$DB_TMP-shm" "$UP_TMP"
  # the container path leaves its staging copy inside the container
  [ -z "${CONTAINER_TMP:-}" ] || docker compose exec -T journal rm -f "$CONTAINER_TMP" "$CONTAINER_TMP-wal" "$CONTAINER_TMP-shm" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if command -v sqlite3 >/dev/null 2>&1; then
  [ -s "$DATA/journal.db" ] || die "no database at $DATA/journal.db (wrong DATA_DIR?)"
  sqlite3 "$DATA/journal.db" ".backup \"$DB_TMP\""
  [ "$(sqlite3 "$DB_TMP" 'pragma journal_mode = delete; pragma integrity_check' | tail -n 1)" = "ok" ] || die "integrity check of the copy failed"
  HAVE_UPLOADS=0
  if [ -d "$DATA/uploads" ]; then
    tar -czf "$UP_TMP" -C "$DATA" uploads
    HAVE_UPLOADS=1
  fi
else
  CONTAINER_TMP="$CDATA/backup-tmp-$STAMP.db"
  docker compose exec -T journal test -s "$CDATA/journal.db" || die "no database in the journal container (is it running?)"
  docker compose exec -T journal sqlite3 "$CDATA/journal.db" ".backup \"$CONTAINER_TMP\""
  [ "$(docker compose exec -T journal sqlite3 "$CONTAINER_TMP" 'pragma journal_mode = delete; pragma integrity_check' | tail -n 1)" = "ok" ] || die "integrity check of the copy failed"
  docker compose exec -T journal cat "$CONTAINER_TMP" > "$DB_TMP"
  HAVE_UPLOADS=0
  if docker compose exec -T journal test -d "$CDATA/uploads"; then
    docker compose exec -T journal tar -czf - -C "$CDATA" uploads > "$UP_TMP"
    HAVE_UPLOADS=1
  fi
fi

[ -s "$DB_TMP" ] || die "the database copy is empty"
mv "$DB_TMP" "$OUT/journal-$STAMP.db"
if [ "$HAVE_UPLOADS" = 1 ]; then
  mv "$UP_TMP" "$OUT/uploads-$STAMP.tar.gz"
else
  echo "note: no uploads directory, so no screenshots archive was written" >&2
fi

# Retention. STAMP sorts oldest to newest, `find | sort` copes with spaces in paths and works on BSD and GNU.
prune() {
  find "$OUT" -maxdepth 1 -type f -name "$1" -print | sort -r | tail -n +"$((KEEP + 1))" | while IFS= read -r f; do rm -f -- "$f"; done
}
prune 'journal-*.db'
prune 'uploads-*.tar.gz'
echo "Backup written to $OUT ($STAMP)"
