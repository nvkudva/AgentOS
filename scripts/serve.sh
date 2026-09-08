#!/usr/bin/env bash
# start/stop the Atrium server. Kills by listening port: setsid means the recorded pid is
# the launcher, not the node process, so a pidfile alone leaves the old server holding 8788.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8788}"

listeners() { lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null; }

stop() {
  local pids
  pids=$(listeners)
  [ -n "${pids:-}" ] || return 0
  kill $pids 2>/dev/null
  for _ in $(seq 12); do
    [ -z "$(listeners)" ] && return 0
    sleep 0.3
  done
  kill -9 $(listeners) 2>/dev/null
  return 0
}

case "${1:-start}" in
  stop) stop; echo "stopped" ;;
  start)
    stop
    cd "$ROOT/server"
    setsid nohup npx tsx src/index.ts > /tmp/atrium.log 2>&1 < /dev/null &
    for _ in $(seq 25); do
      curl -sf -m 1 "localhost:$PORT/api/state" >/dev/null && { echo "up on $PORT"; exit 0; }
      sleep 1
    done
    echo "failed to start"; tail -20 /tmp/atrium.log; exit 1 ;;
esac
