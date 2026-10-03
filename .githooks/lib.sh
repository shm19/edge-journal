# Shared by the git hooks. Plain POSIX sh; no model, no network, no tokens: git runs these scripts itself.

ROOT=$(git rev-parse --show-toplevel) && cd "$ROOT" || exit 1

# Fresh shells on this machine default to an old Node; prefer an installed Node 22+ (nvm layout).
case "$(node -v 2>/dev/null)" in
  v22* | v23* | v24* | v25* | v26*) ;;
  *) for d in "$HOME"/.nvm/versions/node/v22*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done ;;
esac
export PATH

if [ ! -d node_modules ]; then
  echo "Git hook: node_modules is missing. Run: npm ci" >&2
  exit 1
fi

# step "label" command...  Runs quietly; prints one line on success, the tail of the output on failure.
step() {
  label=$1
  shift
  log=$(mktemp)
  start=$(date +%s)
  if "$@" >"$log" 2>&1; then
    echo "  ok    $label ($(($(date +%s) - start))s)"
    rm -f "$log"
  else
    echo "  FAIL  $label ($(($(date +%s) - start))s)"
    tail -n 40 "$log"
    rm -f "$log"
    echo
    echo "Blocked by the git hook (${HOOK_NAME:-hook}). Fix the problem above, or bypass once with --no-verify."
    exit 1
  fi
}
