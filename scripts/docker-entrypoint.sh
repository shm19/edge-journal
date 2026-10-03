#!/bin/sh
# Container entrypoint. A bind-mounted ./data is created by Docker as root, but the app runs as the
# unprivileged `node` user (uid 1000). When started as root: make sure the data dirs exist and are
# owned by node, then drop privileges. When started as any other user (compose `user:` override):
# just run the command (the data dir must then already be writable, see README).
set -eu
DATA=${DATA_DIR:-/data}
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA" "$DATA/uploads"
  chown -R node:node "$DATA"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
