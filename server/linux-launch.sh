#!/usr/bin/env sh
# Linux launcher (used by the ProjectMusic icon in your app menu):
# starts the server in the background if it isn't running yet, then opens the browser.
#   sh linux-launch.sh               start (if needed) + open ProjectMusic
#   sh linux-launch.sh --no-browser  start only (used for autostart at login)
DIR=$(cd "$(dirname "$0")" && pwd)
PORT=${PM_PORT:-8080}
URL="http://localhost:$PORT"
LOG="$DIR/server.log"

is_running() {
  python3 - "$URL/api/health" <<'PY' >/dev/null 2>&1
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=2) as r:
        sys.exit(0 if b'"mode": "server"' in r.read() else 1)
except Exception:
    sys.exit(1)
PY
}

notify() {
  echo "$1"
  command -v notify-send >/dev/null 2>&1 && notify-send -i projectmusic "ProjectMusic" "$1" 2>/dev/null || true
}

if ! is_running; then
  notify "Starting ProjectMusic…"
  nohup sh "$DIR/start.sh" --port "$PORT" >"$LOG" 2>&1 &
  i=0
  while ! is_running; do
    i=$((i + 1))
    if [ "$i" -gt 120 ]; then
      notify "ProjectMusic could not start. Details: $LOG"
      exit 1
    fi
    sleep 1
  done
fi

[ "$1" = "--no-browser" ] && exit 0
for open in xdg-open gio sensible-browser x-www-browser firefox google-chrome chromium; do
  if command -v "$open" >/dev/null 2>&1; then
    if [ "$open" = gio ]; then gio open "$URL" >/dev/null 2>&1 & else "$open" "$URL" >/dev/null 2>&1 & fi
    exit 0
  fi
done
echo "ProjectMusic is running: open $URL in your browser."
