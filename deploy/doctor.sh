#!/bin/sh
# What does this server have? Runs on the server as your normal ssh user (no root needed), streamed by
# `scripts/server.sh doctor` (sh -s -- <port>). Read-only: it changes nothing. POSIX sh.
set -u
PORT=${1:-3000}
BAD=0
WARN=0
FIXES=
ok() { echo "  [ok]    $*"; }
warn() { echo "  [warn]  $*"; WARN=$((WARN + 1)); }
bad() { echo "  [FIX]   $*"; BAD=$((BAD + 1)); }
fix() { FIXES="$FIXES
    $*"; }
has() { command -v "$1" >/dev/null 2>&1; }

echo "Operating system"
if [ -r /etc/os-release ]; then pretty=$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"'); else pretty=unknown; fi
arch=$(uname -m)
case $arch in
  x86_64|amd64|aarch64|arm64) ok "$pretty, $arch" ;;
  *) warn "$pretty, $arch: uncommon CPU; the better-sqlite3 binary may have to be compiled (needs build-essential + python3)" ;;
esac
if has apt-get; then ok "apt is available (Debian/Ubuntu family): init can install what is missing"
else warn "no apt-get: this is not Debian/Ubuntu. You can still deploy, but you have to install sqlite3, curl, Node 22 and build tools yourself"; fi
if [ -d /run/systemd/system ]; then ok "systemd is running (needed for the service and the daily backup timer)"
else bad "systemd is not running here: the service and the backup timer need it. This tool cannot deploy to this server."; fix "use a systemd distro (Debian 11+, Ubuntu 20.04+) or the Docker alternative in the README"; fi

echo "Access (sudo)"
if [ "$(id -u)" = 0 ]; then ok "you are root (works, but a normal user with sudo is cleaner)"
elif ! has sudo; then bad "sudo is not installed and you are not root"; fix "log in as root once and run: apt-get install -y sudo && usermod -aG sudo $(id -un)"
elif sudo -n true 2>/dev/null; then ok "passwordless sudo"
elif id -nG | tr ' ' '\n' | grep -Eqx 'sudo|wheel|admin'; then ok "sudo with a password (you will be asked for it once per command; unattended pull-backups needs passwordless sudo)"
else bad "$(id -un) does not look like a sudoer"; fix "as root: usermod -aG sudo $(id -un)   (then log in again)"; fi

echo "Software"
nodev=
has node && nodev=$(node -v 2>/dev/null)
major=$(echo "${nodev:-v0}" | sed 's/^v//; s/\..*//')
case $major in ''|*[!0-9]*) major=0 ;; esac
if [ "$major" -ge 22 ]; then ok "Node $nodev ($(command -v node))"
elif [ -n "$nodev" ]; then bad "Node $nodev is too old (22 or newer needed)"; fix "./scripts/server.sh init --install-node   (installs Node 22 from NodeSource)"
else bad "Node is not installed (22 or newer needed)"; fix "./scripts/server.sh init --install-node   (installs Node 22 from NodeSource)"; fi
if has sqlite3; then ok "sqlite3 $(sqlite3 --version | cut -d' ' -f1) (used by backups)"
else bad "sqlite3 is missing (backups need it)"; fix "./scripts/server.sh init   (installs it), or: sudo apt-get install -y sqlite3"; fi
has curl && ok "curl" || { warn "curl is missing (init installs it)"; }
has docker && echo "  [info]  Docker is installed (not needed for this path)" || echo "  [info]  Docker is not installed (not needed for this path)"

echo "Memory and disk (next build needs about 1.5 GB RAM+swap and ~1.5 GB disk)"
if [ -r /proc/meminfo ]; then
  mem=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
  swap=$(awk '/^SwapTotal:/ { print int($2 / 1024) }' /proc/meminfo)
  if [ $((mem + swap)) -ge 1500 ]; then ok "RAM $mem MB + swap $swap MB"
  else warn "RAM $mem MB + swap $swap MB is below 1.5 GB: the build may be killed"; fix "./scripts/server.sh init --add-swap   (adds a 2 GB swapfile)"; fi
fi
free_mb=$(df -Pk /opt 2>/dev/null | awk 'NR==2 { print int($4 / 1024) }')
[ -n "$free_mb" ] || free_mb=$(df -Pk / | awk 'NR==2 { print int($4 / 1024) }')
if [ "${free_mb:-0}" -ge 3000 ]; then ok "${free_mb} MB free disk"
elif [ "${free_mb:-0}" -ge 1500 ]; then warn "only ${free_mb} MB free disk: enough for one release, tight for two"
else bad "only ${free_mb} MB free disk (about 1.5 GB needed)"; fix "free some disk space (apt-get clean, remove old logs)"; fi

echo "Network (the build downloads packages and the prebuilt better-sqlite3 binary)"
reach() {
  if has curl; then code=$(curl -sS -m 8 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null) || code=000; [ "$code" != 000 ]
  elif has wget; then wget -q -T 8 -O /dev/null "$1" 2>/dev/null
  else return 2; fi
}
for url in https://registry.npmjs.org/ https://github.com/; do
  reach "$url"; r=$?
  if [ $r = 0 ]; then ok "can reach $url"
  elif [ $r = 2 ]; then warn "cannot test $url (no curl or wget; init installs curl)"
  elif [ "$url" = "https://github.com/" ]; then warn "cannot reach $url: better-sqlite3's prebuilt binary download will fail and it has to be compiled (needs build-essential + python3, which init installs)"
  else bad "cannot reach $url: npm install will fail. Check the server's DNS / firewall / proxy."; fi
done

echo "Port"
if has ss && ss -ltn 2>/dev/null | awk '{ print $4 }' | grep -Eq "[:.]$PORT\$"; then
  if has systemctl && systemctl is-active --quiet edge-journal 2>/dev/null; then ok "port $PORT is used by edge-journal itself"
  else bad "port $PORT is already in use by something else"; fix "pick another port: set PORT=<free port> in .deploy.env (then init), or stop the other service"; fi
elif has ss; then ok "port $PORT is free"
else warn "cannot check whether port $PORT is free (no ss)"; fi

echo
if [ -d /opt/edge-journal/current ] || [ -f /etc/edge-journal/edge-journal.env ]; then echo "Edge Journal is already set up here (init has run)."; fi
if [ "$BAD" -eq 0 ]; then
  if [ "$WARN" -eq 0 ]; then echo "VERDICT: READY. Next: ./scripts/server.sh init"; else echo "VERDICT: READY, with $WARN warning(s) above. Next: ./scripts/server.sh init"; fi
else
  echo "VERDICT: NOT READY: $BAD thing(s) to fix first.${FIXES:+ Fix commands:$FIXES}"
fi
