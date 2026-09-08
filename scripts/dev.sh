#!/usr/bin/env bash
# StoryFlow dev-environment manager — one entry point to start/stop/status the
# two processes that make up the working setup:
#
#   app      Vite dev server on http://localhost:5173 (strictPort)
#   browser  WebMCP-enabled Chromium (CDP on 127.0.0.1:9222, tool host for
#            the storyflow_* tools; script lives in ~/webmcp-retrofit)
#
# Usage:
#   scripts/dev.sh start  [app|browser|all]   default: all
#   scripts/dev.sh stop   [app|browser|all]   default: all
#   scripts/dev.sh status
#   scripts/dev.sh restart [app|browser|all]
#   scripts/dev.sh logs   [app|browser] [N]   last N lines (default 80)
#
# Notes:
#  - stop targets the actual PORT OWNER (via ss), so it also cleanly stops
#    instances that were started outside this script (a bare `npm run dev`
#    in some terminal, a manually launched WebMCP browser).
#  - Logs and pid hints live in /tmp/storyflow-dev/ (safe to delete anytime).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${STORYFLOW_RUN_DIR:-/tmp/storyflow-dev}"
DEV_PORT=5173
CDP_PORT=9222
BROWSER_SCRIPT="$HOME/webmcp-retrofit/scripts/webmcp-chromium.sh"
APP_URL="http://localhost:${DEV_PORT}/"

LOG_APP="$RUN_DIR/vite.log"
LOG_BROWSER="$RUN_DIR/chromium.log"
PID_APP="$RUN_DIR/vite.pid"
PID_BROWSER="$RUN_DIR/chromium.pid"

mkdir -p "$RUN_DIR"

port_pid() {  # pid of the process LISTENing on tcp port $1, empty if none
  ss -tlnp 2>/dev/null | awk -v p=":$1" '$4 ~ p"$"' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
}

http_ok() { curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$1/"; }

alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# state of one target: echoes "<alive:0|1> <pid> <http:0|1>"
probe() {
  local pid_hint pid http
  pid_hint="$(cat "$2" 2>/dev/null || true)"
  pid="$(port_pid "$1")"
  if ! alive "$pid" && alive "$pid_hint"; then pid="$pid_hint"; fi
  [ -n "$pid" ] && echo "$pid" > "$2" || rm -f "$2"
  http=$(http_ok "$1" && echo 1 || echo 0)
  if alive "$pid"; then echo "1 $pid $http"; else echo "0 ${pid:-$pid_hint} $http"; fi
}

wait_http() {  # $1 port, $2 timeout-seconds
  local i=0
  until http_ok "$1"; do
    i=$((i + 1))
    [ "$i" -ge "$2" ] && return 1
    sleep 1
  done
  return 0
}

start_one() {  # $1 name(app|browser)
  case "$1" in
    app)
      read -r a pid h <<< "$(probe "$DEV_PORT" "$PID_APP")"
      if [ "$a" = 1 ]; then
        echo "app      already running (pid $pid, http :$DEV_PORT)"
        return 0
      fi
      if [ -n "$(port_pid "$DEV_PORT")" ]; then
        echo "app      FAILED — port $DEV_PORT is busy but not responding" >&2
        return 1
      fi
      echo "app      starting (vite, log $LOG_APP)…"
      # Launch through a double-fork-ish handoff: an outer setsid bash starts
      # vite in ITS background and exits immediately — the harness/tool shell
      # sees no live children (returns at once), vite is re-parented to init
      # and survives the calling shell's teardown.
      setsid bash -c "cd '$ROOT' && npm run dev >'$LOG_APP' 2>&1 </dev/null & echo \$! >'$PID_APP'"
      if wait_http "$DEV_PORT" 45; then
        read -r _ pid _ <<< "$(probe "$DEV_PORT" "$PID_APP")"
        echo "app      up: $APP_URL (pid $pid)"
      else
        echo "app      FAILED to come up in 45s — see: scripts/dev.sh logs app" >&2
        return 1
      fi
      ;;
    browser)
      if [ ! -x "$BROWSER_SCRIPT" ] && [ ! -f "$BROWSER_SCRIPT" ]; then
        echo "browser  SKIPPED — $BROWSER_SCRIPT not found" >&2
        return 0
      fi
      read -r a pid h <<< "$(probe "$CDP_PORT" "$PID_BROWSER")"
      if [ "$a" = 1 ]; then
        echo "browser  already running (pid $pid, CDP :$CDP_PORT)"
        return 0
      fi
      echo "browser  starting (WebMCP Chromium, log $LOG_BROWSER)…"
      setsid bash -c "bash '$BROWSER_SCRIPT' '$APP_URL' >'$LOG_BROWSER' 2>&1 </dev/null & echo \$! >'$PID_BROWSER'"
      if wait_http "$CDP_PORT" 20; then
        read -r _ pid _ <<< "$(probe "$CDP_PORT" "$PID_BROWSER")"
        echo "browser  up: CDP :$CDP_PORT (pid $pid) — storyflow_* tools live on the page"
      else
        echo "browser  FAILED to expose CDP in 20s — see: scripts/dev.sh logs browser" >&2
        return 1
      fi
      ;;
  esac
}

stop_one() {  # $1 name
  local pidfile
  case "$1" in
    app)     local port=$DEV_PORT;  pidfile=$PID_APP;  label=app ;;
    browser) local port=$CDP_PORT;  pidfile=$PID_BROWSER; label=browser ;;
  esac
  local pid
  pid="$(port_pid "$port")"
  [ -z "$pid" ] && pid="$(cat "$pidfile" 2>/dev/null || true)"
  if ! alive "$pid"; then
    rm -f "$pidfile"
    echo "$label   not running"
    return 0
  fi
  echo "$label   stopping (pid $pid)…"
  kill "$pid" 2>/dev/null
  local i=0
  while alive "$pid" && [ "$i" -lt 10 ]; do i=$((i + 1)); sleep 0.5; done
  if alive "$pid"; then
    echo "$label   did not exit on SIGTERM — sending SIGKILL"
    kill -9 "$pid" 2>/dev/null
    sleep 1
  fi
  rm -f "$pidfile"
  if alive "$(port_pid "$port")"; then
    echo "$label   WARNING: port $port still busy" >&2
    return 1
  fi
  echo "$label   stopped"
}

status_all() {
  local pad="         "
  local a p h
  read -r a p h <<< "$(probe "$DEV_PORT" "$PID_APP")"
  if [ "$a" = 1 ]; then
    echo "app      RUNNING  pid $p  http :$DEV_PORT"
  else
    echo "app      DOWN    (port $DEV_PORT free)"
  fi
  read -r a p h <<< "$(probe "$CDP_PORT" "$PID_BROWSER")"
  if [ "$a" = 1 ]; then
    echo "browser  RUNNING  pid $p  CDP :$CDP_PORT"
  else
    echo "browser  DOWN    (CDP :$CDP_PORT free)"
  fi
}

sel() {  # normalize $2 (default all) into a list of targets
  case "${2:-all}" in
    app)     echo app ;;
    browser) echo browser ;;
    all)     echo app browser ;;
    *) echo "unknown target '$2' (app|browser|all)" >&2; return 1 ;;
  esac
}

cmd="${1:-status}"
case "$cmd" in
  start)
    target="${2:-all}"
    rc=0
    for t in $(sel start "$target"); do start_one "$t" || rc=1; done
    exit $rc
    ;;
  stop)
    target="${2:-all}"
    rc=0
    for t in $(sel stop "$target"); do stop_one "$t" || rc=1; done
    exit $rc
    ;;
  restart)
    target="${2:-all}"
    rc=0
    for t in $(sel restart "$target"); do stop_one "$t" || rc=1; done
    for t in $(sel restart "$target"); do start_one "$t" || rc=1; done
    exit $rc
    ;;
  status)
    status_all
    ;;
  logs)
    case "${2:-app}" in
      app)     f=$LOG_APP ;;
      browser) f=$LOG_BROWSER ;;
      *) echo "unknown log '${2}' (app|browser)" >&2; exit 1 ;;
    esac
    [ -f "$f" ] || { echo "no log yet: $f"; exit 0; }
    tail -n "${3:-80}" "$f"
    ;;
  *)
    grep '^#   scripts/dev.sh' "$0" | sed 's/^#   //'
    exit 1
    ;;
esac
