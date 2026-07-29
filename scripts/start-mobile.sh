#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$PROJECT_DIR/.runtime"
PID_DIR="$RUNTIME_DIR/pids"
LOG_DIR="$RUNTIME_DIR/logs"
PID_FILE="$PID_DIR/mobile-expo.pid"
LOG_FILE="$LOG_DIR/mobile-expo.log"
mkdir -p "$PID_DIR" "$LOG_DIR"

if [[ -f "$PID_FILE" ]] && kill -0 "$(<"$PID_FILE")" 2>/dev/null; then
  echo "Expo est déjà démarré (PID $(<"$PID_FILE"))."
  exit 0
fi

rm -f "$PID_FILE" "$LOG_FILE"
(
  cd "$PROJECT_DIR/mobile"
  # Expo reçoit un pseudo-terminal : son QR et son interface sont ainsi écrits dans le log.
  exec setsid script -q -f -c "npm run dev -- --port 8072" "$LOG_FILE" >/dev/null 2>&1
) &
echo $! >"$PID_FILE"
echo "Expo démarré (PID $(<"$PID_FILE")); logs et QR : $LOG_FILE"
echo "Pour consulter le journal avec les couleurs : less -R $LOG_FILE"
