#!/usr/bin/env bash

# Linux /proc fingerprint for services launched by start-web.sh. A PID alone is
# not sufficient: it can later be reused by an unrelated process.
WEB_BACKEND_PATTERN='npm run dev( |$)|src/main\.ts|dist/main\.js'
WEB_FRONTEND_PATTERN='npm run dev( |$)|[/]vite( |$)'
WEB_WORKER_PATTERN='npm run dev:prevention-worker|dist/workers/prevention\.worker\.js|src/workers/prevention\.worker\.ts'

web_service_fingerprint() {
  local pid="$1"
  local stat_line
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ -r "/proc/$pid/stat" ]] || return 1
  IFS= read -r stat_line <"/proc/$pid/stat" || return 1
  stat_line="${stat_line##*) }"
  local -a fields
  read -r -a fields <<<"$stat_line"
  [[ "${fields[2]:-}" =~ ^[0-9]+$ && "${fields[19]:-}" =~ ^[0-9]+$ ]] || return 1
  printf '%s %s %s\n' "$pid" "${fields[2]}" "${fields[19]}"
}

web_process_identity() {
  local pid="$1"
  local fingerprint owner
  fingerprint="$(web_service_fingerprint "$pid")" || return 1
  owner="$(stat -c %u "/proc/$pid" 2>/dev/null)" || return 1
  [[ "$owner" =~ ^[0-9]+$ ]] || return 1
  printf '%s %s\n' "$fingerprint" "$owner"
}

web_service_matches() {
  local pid_file="$1"
  local service_dir="$2"
  local npm_script="$3"
  local pid pgid start_time extra current command_line cwd
  [[ -f "$pid_file" && ! -L "$pid_file" ]] || return 1
  read -r pid pgid start_time extra <"$pid_file" || return 1
  [[ -z "${extra:-}" && "$pid" =~ ^[0-9]+$ && "$pgid" == "$pid" && "$start_time" =~ ^[0-9]+$ ]] || return 1
  current="$(web_service_fingerprint "$pid")" || return 1
  [[ "$current" == "$pid $pgid $start_time" ]] || return 1
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" || return 1
  [[ "$cwd" == "$service_dir" ]] || return 1
  command_line="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)" || return 1
  [[ "$command_line" == *"npm run $npm_script "* ]]
}

web_validate_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1 && 10#$1 <= 65535 ))
}

web_backend_port() {
  local project_dir="$1"
  local configured=''
  if [[ -f "$project_dir/backend/.env" ]]; then
    configured="$(sed -nE 's/^[[:space:]]*PORT="?([0-9]+)"?([[:space:]]*#.*)?[[:space:]]*$/\1/p' "$project_dir/backend/.env" | tail -n 1)"
  fi
  local port="${PORT:-${configured:-8089}}"
  web_validate_port "$port" || { echo "Port backend invalide : $port" >&2; return 1; }
  printf '%s\n' "$port"
}

web_project_pid_matches() {
  local pid="$1"
  local service_dir="$2"
  local pattern="$3"
  local cwd owner command_line
  owner="$(stat -c %u "/proc/$pid" 2>/dev/null)" || return 1
  [[ "$owner" == "$(id -u)" ]] || return 1
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" || return 1
  [[ "$cwd" == "$service_dir" ]] || return 1
  command_line="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)" || return 1
  [[ "$command_line" =~ $pattern ]]
}

web_project_pids() {
  local service_dir="$1"
  local pattern="$2"
  local pid
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    web_project_pid_matches "$pid" "$service_dir" "$pattern" || continue
    printf '%s\n' "$pid"
  done < <(pgrep -f "$pattern" || true)
}

web_port_listeners() {
  local port="$1"
  web_validate_port "$port" || return 1
  lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

web_pid_listens_on_port() {
  local pid="$1"
  local port="$2"
  web_port_listeners "$port" | grep -Fxq "$pid"
}
