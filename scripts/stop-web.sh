#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_DIR/scripts/web-service-process.sh"
BACKEND_PORT="$(web_backend_port "$PROJECT_DIR")"
FRONTEND_PORT="${WEB_FRONTEND_PORT:-5173}"
web_validate_port "$FRONTEND_PORT" || { echo "Port frontend invalide : $FRONTEND_PORT" >&2; exit 1; }
command -v lsof >/dev/null || { echo "lsof est requis pour arrêter les services Web." >&2; exit 1; }
command -v pgrep >/dev/null || { echo "pgrep est requis pour arrêter les doublons." >&2; exit 1; }
PID_DIR="$PROJECT_DIR/.runtime/pids"
declare -A MANAGED_GRACE_EXHAUSTED=()
if [[ -L "$PROJECT_DIR/.runtime" || -L "$PID_DIR" ]]; then
  echo "Refus : répertoire runtime symbolique." >&2
  exit 1
fi

stop_service() {
  local name="$1"
  local grace_seconds="${2:-5}"
  local service_dir="$3"
  local npm_script="$4"
  local pid_file="$PID_DIR/$name.pid"

  if [[ -L "$PID_DIR" || -L "$pid_file" ]]; then
    echo "Refus : chemin PID symbolique pour $name." >&2
    return 1
  fi
  if [[ ! -f "$pid_file" ]]; then
    echo "$name n’est pas démarré (aucun PID enregistré)."
    return
  fi

  local pid pgid start_time
  if ! web_service_matches "$pid_file" "$service_dir" "$npm_script"; then
    rm -f "$pid_file"
    echo "$name n’est plus identifié comme processus géré ; aucun signal envoyé."
    return
  fi
  read -r pid pgid start_time <"$pid_file"

  echo "Arrêt de $name (PID $pid)..."
  if web_service_matches "$pid_file" "$service_dir" "$npm_script"; then
    kill -TERM -- "-$pid" 2>/dev/null || true
  else
    echo "Identité de $name modifiée avant signal ; aucun groupe signalé."
    rm -f "$pid_file"
    return
  fi
  for ((elapsed=0; elapsed<grace_seconds * 4; elapsed++)); do
    kill -0 -- "-$pid" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 -- "-$pid" 2>/dev/null; then
    MANAGED_GRACE_EXHAUSTED["$name"]=1
    if web_service_matches "$pid_file" "$service_dir" "$npm_script"; then
      echo "$name ne s’est pas arrêté, arrêt forcé."
      kill -KILL -- "-$pid" 2>/dev/null || true
    else
      echo "Le lanceur de $name a disparu ; nettoyage individuel des processus restants."
    fi
  fi
  rm -f "$pid_file"
  echo "$name arrêté."
}

stop_project_processes() {
  local service_dir="$1"
  local pattern="$2"
  local grace_seconds="$3"
  local label="$4"
  local -a pids=()
  mapfile -t pids < <(web_project_pids "$service_dir" "$pattern")
  if ((${#pids[@]} == 0)); then return; fi
  echo "Arrêt des processus $label du projet : ${#pids[@]} détecté(s)."
  signal_project_processes "$service_dir" "$pattern" TERM
  for ((elapsed=0; elapsed<grace_seconds * 4; elapsed++)); do
    mapfile -t pids < <(web_project_pids "$service_dir" "$pattern")
    ((${#pids[@]} == 0)) && return
    sleep 0.25
  done
  signal_project_processes "$service_dir" "$pattern" KILL
}

signal_project_processes() {
  local service_dir="$1"
  local pattern="$2"
  local signal="$3"
  local pid identity
  local -a pids=()
  mapfile -t pids < <(web_project_pids "$service_dir" "$pattern")
  for pid in "${pids[@]}"; do
    identity="$(web_process_identity "$pid" 2>/dev/null)" || continue
    [[ "$identity" == *" $(id -u)" ]] || continue
    web_project_pid_matches "$pid" "$service_dir" "$pattern" || continue
    [[ "$(web_process_identity "$pid" 2>/dev/null)" == "$identity" ]] || continue
    kill -"$signal" "$pid" 2>/dev/null || true
  done
}

stop_service "prevention-worker" 480 "$PROJECT_DIR/backend" "dev:prevention-worker"
if [[ "${MANAGED_GRACE_EXHAUSTED[prevention-worker]:-0}" == 1 ]]; then
  signal_project_processes "$PROJECT_DIR/backend" "$WEB_WORKER_PATTERN" KILL
else
  stop_project_processes "$PROJECT_DIR/backend" "$WEB_WORKER_PATTERN" 480 "worker Prévention"
fi
stop_service "frontend" 5 "$PROJECT_DIR/frontend" "dev"
stop_service "backend" 5 "$PROJECT_DIR/backend" "dev"

if [[ "${MANAGED_GRACE_EXHAUSTED[frontend]:-0}" == 1 ]]; then
  signal_project_processes "$PROJECT_DIR/frontend" "$WEB_FRONTEND_PATTERN" KILL
else
  stop_project_processes "$PROJECT_DIR/frontend" "$WEB_FRONTEND_PATTERN" 5 "frontend"
fi
if [[ "${MANAGED_GRACE_EXHAUSTED[backend]:-0}" == 1 ]]; then
  signal_project_processes "$PROJECT_DIR/backend" "$WEB_BACKEND_PATTERN" KILL
else
  stop_project_processes "$PROJECT_DIR/backend" "$WEB_BACKEND_PATTERN" 5 "backend"
fi

stop_port() {
  local port="$1"
  local -a pids=()
  mapfile -t pids < <(web_port_listeners "$port")
  if ((${#pids[@]} == 0)); then return; fi
  local pid owner
  for pid in "${pids[@]}"; do
    owner="$(stat -c %u "/proc/$pid" 2>/dev/null)" || continue
    if [[ "$owner" != "$(id -u)" ]]; then
      echo "Port $port occupé par un autre utilisateur (PID $pid) ; aucun signal envoyé." >&2
      return 1
    fi
  done
  echo "Libération du port TCP $port : ${#pids[@]} processus à arrêter."
  signal_port_listeners "$port" TERM
  for _ in {1..20}; do
    mapfile -t pids < <(web_port_listeners "$port")
    ((${#pids[@]} == 0)) && return
    sleep 0.25
  done
  signal_port_listeners "$port" KILL
  for _ in {1..4}; do
    mapfile -t pids < <(web_port_listeners "$port")
    ((${#pids[@]} == 0)) && return
    sleep 0.25
  done
  echo "Port $port toujours occupé ; arrêt incomplet." >&2
  return 1
}

signal_port_listeners() {
  local port="$1"
  local signal="$2"
  local pid identity
  local -a pids=()
  mapfile -t pids < <(web_port_listeners "$port")
  for pid in "${pids[@]}"; do
    identity="$(web_process_identity "$pid" 2>/dev/null)" || continue
    [[ "$identity" == *" $(id -u)" ]] || { echo "Port $port occupé par un autre utilisateur ; arrêt incomplet." >&2; return 1; }
    web_pid_listens_on_port "$pid" "$port" || continue
    [[ "$(web_process_identity "$pid" 2>/dev/null)" == "$identity" ]] || continue
    kill -"$signal" "$pid" 2>/dev/null || true
  done
}

stop_port "$FRONTEND_PORT"
stop_port "$BACKEND_PORT"

if [[ -n "$(web_project_pids "$PROJECT_DIR/backend" "$WEB_WORKER_PATTERN")" ]]; then
  echo "Un worker Prévention est toujours actif ; arrêt incomplet." >&2
  exit 1
fi
