#!/usr/bin/env bash
# start/stop the Atrium server without pkill patterns that can match the caller
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID="$ROOT/.atrium.pid"
case "${1:-start}" in
  stop)  [ -f "$PID" ] && kill "$(cat "$PID")" 2>/dev/null || true; rm -f "$PID" ;;
  start)
    [ -f "$PID" ] && kill "$(cat "$PID")" 2>/dev/null || true
    cd "$ROOT/server"
    setsid nohup npx tsx src/index.ts > /tmp/atrium.log 2>&1 < /dev/null &
    echo $! > "$PID"
    for i in $(seq 20); do curl -sf -m 1 localhost:8787/api/state >/dev/null && { echo "up (pid $(cat "$PID"))"; exit 0; }; sleep 1; done
    echo "failed to start"; tail -20 /tmp/atrium.log; exit 1 ;;
esac
