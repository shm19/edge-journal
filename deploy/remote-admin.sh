#!/bin/sh
# Server side of the other `scripts/server.sh` commands (runs as root, through sudo). POSIX sh.
# Usage: remote-admin.sh backup
#        remote-admin.sh status
#        remote-admin.sh stage-backups <N> <out.tar>        (a tarball of the newest N backups for `pull-backups`)
#        remote-admin.sh restore <backup.db> [uploads.tar.gz]
#        remote-admin.sh rollback
#        remote-admin.sh restore-predeploy                  (restore the newest pre-deploy backup)
# Exit codes: 0 ok | 1 failed (see the message) | 4 the app is not healthy afterwards | 5 rollback done but the previous code
# cannot run on the current database: the caller asks the owner whether to restore the pre-deploy backup.
set -eu
umask 077
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/lib.sh"
need_root

cmd=${1:-}
[ $# -gt 0 ] && shift
trap 'unlock' EXIT
trap 'exit 130' INT TERM

newest() { ls -1 "$1"/$2 2>/dev/null | sort | tail -n 1 || true; } # newest file matching a glob in a dir (stamps sort by time)
need_release() { [ -L "$CURRENT" ] && [ -d "$CURRENT/scripts" ] || die "nothing is deployed yet. Run './scripts/server.sh deploy' first."; }

case $cmd in
backup)
  need_release
  [ -s "$DATA/journal.db" ] || die "there is no database at $DATA/journal.db yet"
  take_backup "$BACKUPS" "$CURRENT" || die "the backup failed"
  echo "BACKUP $(basename "$BK_DB")${BK_UP:+ and $(basename "$BK_UP")} in $BACKUPS"
  ;;

status)
  echo "release : $(current_id || true)"
  [ -f "$CURRENT/RELEASE" ] && sed -n 's/^commit=/commit  : /p; s/^describe=/describe : /p; s/^date=/built    : /p' "$CURRENT/RELEASE"
  echo "releases: $(ls -1 "$RELEASES" 2>/dev/null | tr '\n' ' ')"
  echo "service : $($SYSTEMCTL show -p ActiveState -p SubState -p NRestarts -p ActiveEnterTimestamp "$SVC" 2>/dev/null | tr '\n' ' ' || echo unknown)"
  code=$($CURL -s -o /dev/null -w '%{http_code}' --max-time 5 "$(health_url)" 2>/dev/null) || code=000
  echo "health  : HTTP $code at $(health_url)"
  [ "$code" = 200 ] || echo "WARN: the app is not answering healthy. See: ./scripts/server.sh logs"
  last=$(newest "$BACKUPS" 'journal-*.db')
  if [ -n "$last" ]; then
    age_h=$(( ($(date +%s) - $(mtime "$last")) / 3600 ))
    echo "backup  : $(basename "$last") ($(human "$(wc -c < "$last")"), ${age_h} h old; $(ls -1 "$BACKUPS"/journal-*.db | wc -l | tr -d ' ') kept)"
    [ "$age_h" -le 36 ] || echo "WARN: the newest backup is $age_h hours old (the daily timer should make one every day). Check: systemctl status edge-journal-backup.timer"
  else
    echo "backup  : none yet"
    echo "WARN: there is no scheduled backup yet. Run: ./scripts/server.sh backup"
  fi
  pre=$(newest "$PREDEPLOY" 'journal-*.db')
  if [ -n "$pre" ]; then echo "pre-deploy backup: $(basename "$pre")"; else echo "pre-deploy backup: none yet (the first deploy has no database to back up)"; fi
  data_kb=$(du -sk "$DATA" 2>/dev/null | awk '{ print $1 }')
  echo "data    : $(human $((${data_kb:-0} * 1024))) in $DATA; $(df -Pk "$DATA" 2>/dev/null | awk 'NR==2 { printf "%.1f GB free on that disk", $4 / 1048576 }')"
  echo "app's own pre-migrate copies: $(ls -1 "$DATA"/backups/pre-migrate-*.db 2>/dev/null | wc -l | tr -d ' ')"
  echo "since   : $(date -u '+%Y-%m-%d %H:%M UTC') (server clock)"
  ;;

stage-backups)
  n=${1:-7}
  out=${2:-}
  case $n in ''|*[!0-9]*) die "N must be a number" ;; esac
  [ -n "$out" ] || die "usage: stage-backups <N> <out.tar>"
  [ -d "$BACKUPS" ] || die "no backups directory yet. Run './scripts/server.sh backup' first."
  files=$(ls -1 "$BACKUPS" 2>/dev/null | grep -E '^journal-[0-9A-Za-z-]+\.db$' | sort -r | head -n "$n" || true)
  up=$(ls -1 "$BACKUPS" 2>/dev/null | grep -E '^uploads-[0-9A-Za-z-]+\.tar\.gz$' | sort -r | head -n 1 || true)
  [ -n "$files" ] || die "there is no backup to copy yet. Run './scripts/server.sh backup' first."
  # shellcheck disable=SC2086
  (cd "$BACKUPS" && tar -cf - $files $up) > "$out"
  chmod 600 "$out"
  own "$(ls -ld "$(dirname "$out")" | awk '{ print $3 }')" "$out" # hand it to the ssh user, who scp's it down
  echo "STAGED $out ($(echo "$files" | wc -l | tr -d ' ') database copies${up:+ + $up})"
  ;;

restore)
  db=${1:-}
  up=${2:-}
  [ -f "$db" ] || die "backup file not found: $db"
  [ -z "$up" ] || [ -f "$up" ] || die "uploads archive not found: $up"
  need_release
  lock
  [ "$(sqlite3 -readonly "$db" 'pragma integrity_check' | tail -n 1)" = ok ] || die "$db failed its integrity check; nothing was changed"
  stamp=$(date +%Y%m%d-%H%M%S)
  inbox=$BACKUPS/restore-in
  mkdir -p "$inbox"
  own "$SVC_USER:$SVC_USER" "$BACKUPS" "$inbox"
  chmod 700 "$inbox"
  cp "$db" "$inbox/$stamp-$(basename "$db")"
  [ -z "$up" ] || cp "$up" "$inbox/$stamp-$(basename "$up")"
  own -R "$SVC_USER:$SVC_USER" "$inbox"
  log "restore: stopping the app"
  svc_stop
  if restore_db "$CURRENT/scripts/restore.sh" "$inbox/$stamp-$(basename "$db")" ${up:+"$inbox/$stamp-$(basename "$up")"}; then ok=1; else ok=0; fi
  svc_start || true
  if [ "$ok" = 0 ]; then
    log "RESTORE FAILED; restore.sh put the previous database back (see its message above). The app was started again."
    wait_healthy 60 || log "WARNING: the app is not healthy: ./scripts/server.sh logs"
    exit 1
  fi
  if wait_healthy 90; then
    log "RESTORED from $(basename "$db"); the app is healthy. The database it replaced is kept as $DATA/journal.db.pre-restore-* (delete it yourself when you are sure)."
  else
    log "restored, but the app is NOT healthy. Probably the backup is from a newer version than the deployed one. ./scripts/server.sh logs ; nothing was deleted."
    exit 4
  fi
  ;;

rollback)
  need_release
  lock
  cur=$(current_id)
  prev=$(ls -1 "$RELEASES" | sort | awk -v c="$cur" '$0 < c { p = $0 } END { print p }')
  [ -n "$prev" ] || die "there is no release older than $cur to go back to"
  log "rollback: $cur -> $prev"
  swap_link "$prev"
  svc_restart || true
  if wait_healthy 60; then
    log "ROLLED BACK to $prev and it is healthy. $cur is kept. If the newer version had changed the database, the old code coped with it."
    exit 0
  fi
  pre=$(newest "$PREDEPLOY" 'journal-*.db')
  log "$prev is running but NOT healthy: it probably refuses the database because $cur migrated it ('database is newer than this version')."
  if [ -n "$pre" ]; then
    log "Newest pre-deploy backup: $(basename "$pre") (taken $(( ($(date +%s) - $(mtime "$pre")) / 60 )) minutes ago)."
    log "Restoring it makes $prev work again but LOSES everything written since then. Nothing is deleted either way."
  fi
  exit 5
  ;;

restore-predeploy)
  need_release
  lock
  pre=$(newest "$PREDEPLOY" 'journal-*.db')
  [ -n "$pre" ] || die "there is no pre-deploy backup in $PREDEPLOY"
  log "restore-predeploy: restoring $(basename "$pre")"
  svc_stop || true
  if restore_db "$CURRENT/scripts/restore.sh" "$pre"; then ok=1; else ok=0; fi
  svc_start || true
  [ "$ok" = 1 ] || { log "RESTORE FAILED; the previous database was put back."; exit 1; }
  if wait_healthy 60; then
    log "RESTORED $(basename "$pre"); the app is healthy. The database it replaced is kept as $DATA/journal.db.pre-restore-*."
  else
    log "restored, but the app is NOT healthy: ./scripts/server.sh logs"
    exit 4
  fi
  ;;

*)
  echo "usage: remote-admin.sh backup|status|stage-backups|restore|rollback|restore-predeploy" >&2
  exit 1
  ;;
esac
