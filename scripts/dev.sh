#!/usr/bin/env bash
# Backend on 8787, Vite (with /api proxied to it) on 5173.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kill_port() { local p; p=$(lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null); [ -n "${p:-}" ] && kill $p 2>/dev/null; sleep 1; return 0; }
case "${1:-start}" in
  stop) kill_port 8787; kill_port 5173; echo stopped ;;
  start)
    kill_port 5173
    "$ROOT/scripts/serve.sh" start
    cd "$ROOT/web"
    setsid nohup npx vite --host 0.0.0.0 --port 5173 > /tmp/atrium-vite.log 2>&1 < /dev/null &
    for _ in $(seq 25); do
      curl -sf -m 1 localhost:5173 >/dev/null && { echo "vite up on 5173"; exit 0; }
      sleep 1
    done
    echo "vite failed"; tail -20 /tmp/atrium-vite.log; exit 1 ;;
esac
