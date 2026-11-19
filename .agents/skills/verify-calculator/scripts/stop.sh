#!/usr/bin/env bash
# Stop the instance started by launch.sh for this port. Never kills by process name.
# Removes the instance's scratch dir (pid/log), never the evidence tree.
set -euo pipefail

PORT="${VERIFY_PORT:-4173}"
RUN_DIR="${VERIFY_RUN_DIR:-/tmp/verify-calculator/port-$PORT}"
PID_FILE="$RUN_DIR/server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "not-running run_dir=$RUN_DIR"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  CMD="$(tr '\0' ' ' <"/proc/$PID/cmdline" 2>/dev/null || true)"
  case "$CMD" in
    *"http.server"*)
      kill "$PID"
      for _ in $(seq 1 25); do
        kill -0 "$PID" 2>/dev/null || break
        sleep 0.2
      done
      if kill -0 "$PID" 2>/dev/null; then
        kill -9 "$PID"
      fi
      ;;
    *)
      echo "REFUSE pid=$PID cmd=$CMD hint=pid-file does not describe our server" >&2
      exit 2
      ;;
  esac
fi

rm -rf "$RUN_DIR"
echo "stopped port=$PORT scratch_removed=$RUN_DIR"
