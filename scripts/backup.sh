#!/usr/bin/env sh
# Consistent online backup of the journal (DB + screenshots). Keeps the last 30.
# Cron example (daily 03:00):  0 3 * * * /path/to/edge-journal/scripts/backup.sh
set -eu
cd "$(dirname "$0")/.."
DATA=${DATA_DIR:-./data}
OUT=${BACKUP_DIR:-./backups}
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DATA/journal.db" ".backup '$OUT/journal-$STAMP.db'"
else
  docker compose exec -T journal sqlite3 /data/journal.db ".backup '/data/backup-tmp.db'"
  mv "$DATA/backup-tmp.db" "$OUT/journal-$STAMP.db"
fi
tar -czf "$OUT/uploads-$STAMP.tar.gz" -C "$DATA" uploads
ls -1t "$OUT"/journal-*.db 2>/dev/null | tail -n +31 | xargs -r rm -f
ls -1t "$OUT"/uploads-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
echo "Backup written to $OUT ($STAMP)"
