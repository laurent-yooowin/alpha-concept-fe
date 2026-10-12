#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_DIR/scripts/web-service-process.sh"
BACKEND_PORT="$(web_backend_port "$PROJECT_DIR")"
FRONTEND_PORT="${WEB_FRONTEND_PORT:-5173}"
web_validate_port "$FRONTEND_PORT" || { echo "Port frontend invalide : $FRONTEND_PORT" >&2; exit 1; }
command -v lsof >/dev/null || { echo "lsof est requis pour vérifier les ports Web." >&2; exit 1; }
command -v pgrep >/dev/null || { echo "pgrep est requis pour détecter les doublons." >&2; exit 1; }
if [[ "${WEB_PREVENTION_AI_OUTAGE_TEST:-0}" != "0" && "${WEB_PREVENTION_AI_OUTAGE_TEST:-0}" != "1" ]]; then
  echo "WEB_PREVENTION_AI_OUTAGE_TEST doit valoir 0 ou 1." >&2
  exit 1
fi
if [[ "${WEB_PREVENTION_AI_OUTAGE_TEST:-0}" == "1" ]]; then
  if [[ ! -f "$PROJECT_DIR/backend/.env" ]] ||
     ! grep -Eq '^[[:space:]]*DATABASE_HOST=(localhost|127\.0\.0\.1)[[:space:]]*$' "$PROJECT_DIR/backend/.env" ||
     ! grep -Eq '^[[:space:]]*DATABASE_NAME=csps_db_dev[[:space:]]*$' "$PROJECT_DIR/backend/.env" ||
     ! grep -Eq '^[[:space:]]*NODE_ENV=development[[:space:]]*$' "$PROJECT_DIR/backend/.env"; then
    echo "Injection IA refusée hors base locale de développement." >&2
    exit 1
  fi
  if [[ ! "${WEB_PREVENTION_AI_FAULT_ORGANIZATION_ID:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "Organisation cible du test IA invalide." >&2
    exit 1
  fi
  if [[ -e "$PROJECT_DIR/.runtime/logs/prevention-ai-outage.flag" ||
        -L "$PROJECT_DIR/.runtime/logs/prevention-ai-outage.flag" ]]; then
    echo "Ancien marqueur de panne IA présent ; démarrage refusé." >&2
    exit 1
  fi
fi

# A start is a clean restart. Do not allow Vite to silently choose a second port.
"$PROJECT_DIR/scripts/stop-web.sh"
if [[ -n "$(web_port_listeners "$BACKEND_PORT")$(web_port_listeners "$FRONTEND_PORT")" ||
      -n "$(web_project_pids "$PROJECT_DIR/backend" "$WEB_BACKEND_PATTERN")" ||
      -n "$(web_project_pids "$PROJECT_DIR/frontend" "$WEB_FRONTEND_PATTERN")" ||
      -n "$(web_project_pids "$PROJECT_DIR/backend" "$WEB_WORKER_PATTERN")" ]]; then
  echo "Démarrage refusé : un port ou un processus Web/Prévention est encore occupé." >&2
  exit 1
fi
RUNTIME_DIR="$PROJECT_DIR/.runtime"
PID_DIR="$RUNTIME_DIR/pids"
LOG_DIR="$RUNTIME_DIR/logs"
for dir in "$RUNTIME_DIR" "$PID_DIR" "$LOG_DIR"; do
  if [[ -L "$dir" ]]; then
    echo "Refus : répertoire runtime symbolique ($dir)." >&2
    exit 1
  fi
done
mkdir -p "$PID_DIR" "$LOG_DIR"
chmod 700 "$RUNTIME_DIR" "$PID_DIR" "$LOG_DIR"

start_service() {
  local name="$1"
  local service_dir="$2"
  local npm_script="$3"
  shift 3
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if [[ -L "$pid_file" || -L "$log_file" ]]; then
    echo "Refus : chemin PID/log symbolique pour $name." >&2
    return 1
  fi
  if web_service_matches "$pid_file" "$service_dir" "$npm_script"; then
    local recorded_pid recorded_pgid recorded_start
    read -r recorded_pid recorded_pgid recorded_start <"$pid_file"
    echo "$name est déjà démarré (PID $recorded_pid)."
    return
  fi

  if [[ "$name" == "prevention-worker" && -n "$(web_project_pids "$service_dir" "$WEB_WORKER_PATTERN")" ]]; then
    echo "Worker Prévention déjà actif ; démarrage refusé pour éviter un doublon." >&2
    return 1
  fi

  rm -f "$pid_file"
  touch "$log_file"
  chmod 600 "$log_file"
  (
    cd "$service_dir"
    exec setsid "$@"
  ) >"$log_file" 2>&1 &
  local pid=$! fingerprint=''
  for _ in {1..40}; do
    fingerprint="$(web_service_fingerprint "$pid" 2>/dev/null)" || fingerprint=''
    if [[ "$fingerprint" == "$pid $pid "* ]]; then break; fi
    sleep 0.05
  done
  if [[ "$fingerprint" != "$pid $pid "* ]]; then
    echo "Échec du démarrage de $name ; vérifier $log_file." >&2
    return 1
  fi
  printf '%s\n' "$fingerprint" >"$pid_file"
  echo "$name démarré (PID $pid); logs : $log_file"
}

start_service "backend" "$PROJECT_DIR/backend" "dev" env PORT="$BACKEND_PORT" npm run dev
worker_command=(npm run dev:prevention-worker)
if [[ "${WEB_PREVENTION_AI_OUTAGE_TEST:-0}" == "1" ]]; then
  worker_command=(env "PREVENTION_AI_FAULT_MARKER=$LOG_DIR/prevention-ai-outage.flag" \
    "PREVENTION_AI_FAULT_ORGANIZATION_ID=$WEB_PREVENTION_AI_FAULT_ORGANIZATION_ID" \
    "NODE_OPTIONS=${NODE_OPTIONS:+$NODE_OPTIONS }--require=$PROJECT_DIR/scripts/prevention-ai-outage-hook.cjs" \
    npm run dev:prevention-worker)
fi
start_service "prevention-worker" "$PROJECT_DIR/backend" "dev:prevention-worker" "${worker_command[@]}"
start_service "frontend" "$PROJECT_DIR/frontend" "dev" npm run dev -- --port "$FRONTEND_PORT" --strictPort

echo "L’API, le worker Prévention et le frontend sont en cours de démarrage."
