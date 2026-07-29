#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$PROJECT_DIR/.runtime/pids/mobile-expo.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Expo n’est pas démarré (aucun PID enregistré)."
  exit 0
fi

pid="$(<"$PID_FILE")"
if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Expo est déjà arrêté."
  exit 0
fi

echo "Arrêt d’Expo (PID $pid)..."
kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
for _ in {1..20}; do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.25
done
if kill -0 "$pid" 2>/dev/null; then
  echo "Expo ne s’est pas arrêté, arrêt forcé."
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
fi
rm -f "$PID_FILE"
echo "Expo arrêté."
