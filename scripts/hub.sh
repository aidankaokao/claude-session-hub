#!/bin/bash
# Manage the Session Hub server as a detached background process.
# Usage: hub.sh start | stop | restart | status | logs
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$ROOT/server/index.mjs"
STATE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/session-hub"
PID_FILE="$STATE_DIR/hub.pid"
LOG_FILE="$STATE_DIR/hub.log"
PORT="${CLAUDE_HUB_PORT:-4317}"
URL="http://127.0.0.1:$PORT"

mkdir -p "$STATE_DIR"

# Only trust a pid that is still running this project's server (pids get reused).
# Started via `npm start` the command is relative (node server/index.mjs), so check its cwd too.
is_hub_pid() {
  local cmd cwd
  [ -n "${1:-}" ] || return 1
  cmd=$(ps -p "$1" -o command= 2>/dev/null) || return 1
  case "$cmd" in
    *"$SERVER"*) return 0 ;;
    *server/index.mjs*) ;;
    *) return 1 ;;
  esac
  cwd=$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  [ "$cwd" = "$ROOT" ]
}

# The hub's pid: from the pid file, or whoever listens on the port if it is our server
# (e.g. one started by hand with `npm start`).
hub_pid() {
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if is_hub_pid "$pid"; then echo "$pid"; return; fi
  pid=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)
  if is_hub_pid "$pid"; then echo "$pid"; fi
}

start() {
  local pid
  pid=$(hub_pid)
  if [ -n "$pid" ]; then
    echo "Hub already running (pid $pid) → $URL"
    return
  fi
  if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is used by another program; set CLAUDE_HUB_PORT to use a different port." >&2
    exit 1
  fi
  nohup node "$SERVER" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  # wait up to 5s for the server to answer
  for _ in $(seq 1 50); do
    if curl -s -o /dev/null "$URL/api/state"; then
      echo "Hub started (pid $(cat "$PID_FILE")) → $URL"
      return
    fi
    sleep 0.1
  done
  echo "Hub did not come up; last log lines:" >&2
  tail -n 20 "$LOG_FILE" >&2
  exit 1
}

stop() {
  local pid
  pid=$(hub_pid)
  if [ -z "$pid" ]; then
    echo "Hub is not running"
    rm -f "$PID_FILE"
    return
  fi
  kill "$pid"
  for _ in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid"; fi
  rm -f "$PID_FILE"
  echo "Hub stopped (pid $pid)"
}

status() {
  local pid
  pid=$(hub_pid)
  if [ -n "$pid" ]; then
    echo "Hub running (pid $pid) → $URL"
    echo "Log: $LOG_FILE"
  else
    echo "Hub is not running"
    exit 1
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) tail -n 50 -f "$LOG_FILE" ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
