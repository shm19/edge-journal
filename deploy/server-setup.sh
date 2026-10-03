#!/bin/sh
# One-time (and safe to repeat) server preparation. Runs as root, through sudo, from `scripts/server.sh init`. POSIX sh.
# Usage: server-setup.sh [--install-node] [--add-swap] [--yes] [--env-stage <file>]
#   --env-stage  KEY=value lines staged by the laptop (never on a command line): a missing /etc/edge-journal/edge-journal.env is
#                created from them; an existing one only gets those keys replaced (so a re-run never changes the password or
#                SESSION_SECRET unless the laptop was asked to).
# Env for tests: ROOT, NO_ROOT=1, SYSTEMCTL, UNIT_DIR, ASSUME_YES=1.
set -eu
umask 022
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=${ROOT:-}
NO_ROOT=${NO_ROOT:-0}
SYSTEMCTL=${SYSTEMCTL:-systemctl}
UNIT_DIR=${UNIT_DIR:-$ROOT/etc/systemd/system}
SVC_USER=edge-journal
APP=$ROOT/opt/edge-journal
DATA=$ROOT/var/lib/edge-journal
BACKUPS=$ROOT/var/backups/edge-journal
CONF=$ROOT/etc/edge-journal
ENV_FILE=$CONF/edge-journal.env

INSTALL_NODE=0
ADD_SWAP=0
STAGE=
ASSUME_YES=${ASSUME_YES:-0}
while [ $# -gt 0 ]; do
  case $1 in
    --install-node) INSTALL_NODE=1 ;;
    --add-swap) ADD_SWAP=1 ;;
    --yes) ASSUME_YES=1 ;;
    --env-stage) shift; STAGE=${1:-} ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
cleanup() { [ -z "$STAGE" ] || rm -f "$STAGE"; } # the staged file holds the password: never leave it behind
trap cleanup EXIT

say() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
own() { [ "$NO_ROOT" = 1 ] || chown "$@"; }
[ "$NO_ROOT" = 1 ] || [ "$(id -u)" = 0 ] || die "run this as root (the laptop script uses sudo)"
[ "$NO_ROOT" = 1 ] || [ -d /run/systemd/system ] || die "this server does not run systemd, which the service and the backup timer need"

# ---- what is missing? --------------------------------------------------------------------------------------------------
have_pkg() { dpkg -s "$1" 2>/dev/null | grep -q "^Status: install ok installed"; }
MISSING=
if command -v dpkg >/dev/null 2>&1; then
  for p in sqlite3 curl ca-certificates build-essential python3; do have_pkg "$p" || MISSING="$MISSING $p"; done
else
  for c in sqlite3 curl make g++ python3; do command -v "$c" >/dev/null 2>&1 || MISSING="$MISSING $c"; done
fi
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
NODE_PATH_ABS=$(command -v node 2>/dev/null || true)
mem_mb=$(awk '/^(MemTotal|SwapTotal):/ { kb += $2 } END { print int(kb / 1024) }' "${MEMINFO:-/proc/meminfo}" 2>/dev/null || echo 9999)

echo "This will prepare the server for Edge Journal:"
[ -z "$MISSING" ] && echo "  - system packages: nothing missing" || echo "  - install with apt:$MISSING (build-essential + python3 are only used if the better-sqlite3 binary cannot be downloaded)"
if [ "$node_major" -ge 22 ]; then echo "  - Node $(node -v): ok"
elif [ "$INSTALL_NODE" = 1 ]; then echo "  - install Node 22 from NodeSource (https://deb.nodesource.com) with apt"
else
  echo "  - Node 22 or newer is REQUIRED and was not found (found: $(node -v 2>/dev/null || echo none))."
  echo "    Either re-run with --install-node (NodeSource apt repository), or install it yourself, e.g. with the instructions on"
  echo "    https://nodejs.org/en/download (a system-wide node in /usr/bin or /usr/local/bin, not an nvm copy in your home)."
  die "Node 22 is missing; nothing was changed."
fi
[ "$ADD_SWAP" = 1 ] && { [ "$mem_mb" -ge 2048 ] && echo "  - swap: RAM+swap is already ${mem_mb} MB, no swapfile needed" || echo "  - add a 2 GB swapfile /swapfile (RAM+swap is ${mem_mb} MB)"; }
echo "  - create the system user '$SVC_USER' (no login), $APP, $DATA (0700), $BACKUPS (0700)"
echo "  - install the systemd units edge-journal.service and edge-journal-backup.{service,timer} (daily 03:00)"
[ -e "$ENV_FILE" ] && echo "  - keep your existing $ENV_FILE${STAGE:+ (only the keys you just entered are replaced)}" || echo "  - create $ENV_FILE (root only, 0600)"
if [ "$ASSUME_YES" != 1 ]; then
  printf 'Continue? [y/N] '
  answer=n
  read -r answer < /dev/tty || answer=n
  case $answer in y|Y|yes|YES) ;; *) die "cancelled; nothing was changed." ;; esac
fi

# ---- packages, node, swap ----------------------------------------------------------------------------------------------
if [ -n "$MISSING" ]; then
  command -v apt-get >/dev/null 2>&1 || die "apt-get not found: this is not Debian/Ubuntu. Install these yourself and re-run:$MISSING"
  say "apt: installing$MISSING"
  apt-get update
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $MISSING
fi
if [ "$node_major" -lt 22 ]; then
  say "installing Node 22 from NodeSource"
  command -v curl >/dev/null 2>&1 || die "curl is needed to install Node"
  ns=$(mktemp) # download first: a failed download must not be piped into bash as an empty script
  curl -fsSL -o "$ns" https://deb.nodesource.com/setup_22.x || die "could not download the NodeSource setup script"
  bash "$ns"
  rm -f "$ns"
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  NODE_PATH_ABS=$(command -v node || true)
  [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ] || die "Node 22 is still not available after the install (found: $(node -v 2>/dev/null || echo none))"
fi
[ -n "$NODE_PATH_ABS" ] || die "node was not found after the install"
case $NODE_PATH_ABS in /home/*|/root/*) die "node is at $NODE_PATH_ABS, which the hardened service cannot read. Install a system-wide Node 22 (--install-node)." ;; esac
if [ "$ADD_SWAP" = 1 ] && [ "$mem_mb" -lt 2048 ]; then
  if [ -e "$ROOT/swapfile" ]; then
    say "/swapfile already exists: leaving it alone"
  else
    say "creating a 2 GB swapfile"
    fallocate -l 2G "$ROOT/swapfile" 2>/dev/null || dd if=/dev/zero of="$ROOT/swapfile" bs=1M count=2048
    chmod 600 "$ROOT/swapfile"
    mkswap "$ROOT/swapfile"
    swapon "$ROOT/swapfile"
    grep -q '^/swapfile ' "$ROOT/etc/fstab" 2>/dev/null || echo '/swapfile none swap sw 0 0' >> "$ROOT/etc/fstab"
  fi
fi

# ---- user and directories ----------------------------------------------------------------------------------------------
if [ "$NO_ROOT" != 1 ] && ! id "$SVC_USER" >/dev/null 2>&1; then
  say "creating the system user $SVC_USER"
  nologin=/usr/sbin/nologin; [ -x "$nologin" ] || nologin=/sbin/nologin; [ -x "$nologin" ] || nologin=/bin/false
  useradd --system --user-group --home-dir /opt/edge-journal/.home --no-create-home --shell "$nologin" "$SVC_USER"
fi
mkdir -p "$APP/releases" "$APP/.home" "$DATA" "$BACKUPS/pre-deploy" "$CONF"
chmod 755 "$APP" "$APP/releases" "$CONF"
for d in "$APP/.home" "$DATA" "$BACKUPS" "$BACKUPS/pre-deploy"; do
  own "$SVC_USER:$SVC_USER" "$d"
  chmod 700 "$d"
done

# ---- systemd units ----------------------------------------------------------------------------------------------------
say "installing the systemd units (node: $NODE_PATH_ABS)"
mkdir -p "$UNIT_DIR"
sed "s|@NODE@|$NODE_PATH_ABS|" "$HERE/edge-journal.service" > "$UNIT_DIR/edge-journal.service"
cp "$HERE/edge-journal-backup.service" "$HERE/edge-journal-backup.timer" "$UNIT_DIR/"
chmod 644 "$UNIT_DIR"/edge-journal*.service "$UNIT_DIR"/edge-journal*.timer

# ---- the env file: created once, never silently changed -----------------------------------------------------------------
if [ -n "$STAGE" ]; then
  [ -s "$STAGE" ] || die "the staged settings file is empty"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case ${line%%=*} in ''|*[!A-Z_]*) die "bad key in the staged settings" ;; esac
  done < "$STAGE"
  if [ -e "$ENV_FILE" ]; then
    say "updating the keys you entered in $ENV_FILE (the others stay as they are)"
    tmp=$ENV_FILE.new.$$
    ( umask 077; cp "$ENV_FILE" "$tmp" )
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      grep -v "^${line%%=*}=" "$tmp" > "$tmp.2" || true
      mv "$tmp.2" "$tmp"
    done < "$STAGE"
    [ -z "$(tail -c 1 "$tmp")" ] || echo >> "$tmp" # the file must end with a newline before we append
    cat "$STAGE" >> "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    say "creating $ENV_FILE"
    ( umask 077; { echo "# Edge Journal settings (root only). After editing: sudo systemctl restart edge-journal"; cat "$STAGE"; } > "$ENV_FILE" )
  fi
  own root:root "$ENV_FILE"
  chmod 600 "$ENV_FILE"
elif [ ! -e "$ENV_FILE" ]; then
  die "$ENV_FILE does not exist and no settings were provided (run './scripts/server.sh init' from your laptop)"
else
  say "keeping the existing $ENV_FILE untouched (password and SESSION_SECRET unchanged)"
fi

if [ "$NO_ROOT" != 1 ]; then
  $SYSTEMCTL daemon-reload
  $SYSTEMCTL enable edge-journal.service edge-journal-backup.timer
  $SYSTEMCTL start edge-journal-backup.timer
  # new password / secret / listen address: only a restart applies them (a first init has no release yet)
  if [ -n "$STAGE" ] && [ -L "$APP/current" ]; then
    say "restarting edge-journal to apply the new settings"
    $SYSTEMCTL restart edge-journal.service
  fi
fi
say "server prepared. Next, from your laptop: ./scripts/server.sh deploy"
[ "$mem_mb" -ge 1500 ] || echo "warning: only ${mem_mb} MB of RAM+swap: 'next build' needs about 1.5 GB. Re-run init with --add-swap."
