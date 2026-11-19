#!/usr/bin/env bash
# Start a disposable static server for the calculator. One port == one instance.
#
#   bash scripts/launch.sh                  # http://127.0.0.1:4173
#   VERIFY_PORT=4180 bash scripts/launch.sh # a second, independent instance
#
# Readiness means: HTTP 200 at / AND the served document contains the app title.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"

PORT="${VERIFY_PORT:-4173}"
HOST="127.0.0.1"
URL="http://$HOST:$PORT"
RUN_DIR="${VERIFY_RUN_DIR:-/tmp/verify-calculator/port-$PORT}"
ARTIFACT="$REPO_ROOT/index.html"
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"

if [[ ! -f "$ARTIFACT" ]]; then
  echo "FAIL artifact_missing path=$ARTIFACT" >&2
  exit 2
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already-running url=$URL pid=$(cat "$PID_FILE") run_dir=$RUN_DIR"
  echo "artifact_sha256=$(sha256sum "$ARTIFACT" | cut -d' ' -f1)"
  exit 0
fi

if curl -fsS -o /dev/null --max-time 2 "$URL/" 2>/dev/null; then
  echo "FAIL port_in_use url=$URL hint=set VERIFY_PORT to a free port" >&2
  exit 2
fi

mkdir -p "$RUN_DIR"
: >"$LOG_FILE"
nohup python3 -m http.server "$PORT" --bind "$HOST" --directory "$REPO_ROOT" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

for _ in $(seq 1 50); do
  if curl -fsS --max-time 1 "$URL/" 2>/dev/null | grep -q '手机计算器'; then
    echo "ready url=$URL run_dir=$RUN_DIR pid=$(cat "$PID_FILE")"
    echo "artifact_sha256=$(sha256sum "$ARTIFACT" | cut -d' ' -f1)"
    exit 0
  fi
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

tail -n 20 "$LOG_FILE" >&2 || true
echo "FAIL server_not_ready url=$URL log=$LOG_FILE" >&2
exit 1
