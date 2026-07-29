#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$PROJECT_DIR/.runtime"
PID_DIR="$RUNTIME_DIR/pids"
LOG_DIR="$RUNTIME_DIR/logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

start_service() {
  local name="$1"
  local service_dir="$2"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if [[ -f "$pid_file" ]] && kill -0 "$(<"$pid_file")" 2>/dev/null; then
    echo "$name est déjà démarré (PID $(<"$pid_file"))."
    return
  fi

  rm -f "$pid_file"
  (
    cd "$service_dir"
    exec setsid npm run dev
  ) >"$log_file" 2>&1 &
  echo $! >"$pid_file"
  echo "$name démarré (PID $(<"$pid_file")); logs : $log_file"
}

start_service "backend" "$PROJECT_DIR/backend"
start_service "frontend" "$PROJECT_DIR/frontend"

echo "Les serveurs backend et frontend sont en cours de démarrage."
