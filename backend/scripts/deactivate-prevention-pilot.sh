#!/usr/bin/env bash
# Disable the selected Prevention pilot without deleting analytical data.
set -Eeuo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "Usage: $0 <organization-uuid>" >&2
  exit 2
fi

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
readonly PILOT_ID="$1"
readonly MYSQL_HOST_VALUE="${MYSQL_HOST:-127.0.0.1}"
readonly MYSQL_PORT_VALUE="${MYSQL_PORT:-3306}"
readonly MYSQL_USER_VALUE="${MYSQL_USER:-root}"
MYSQL_PASSWORD_VALUE="${MYSQL_PASSWORD:-}"
export MYSQL_PWD="${MYSQL_PWD:-$MYSQL_PASSWORD_VALUE}"

mysql_args=(--protocol=TCP -h "$MYSQL_HOST_VALUE" -P "$MYSQL_PORT_VALUE" -u "$MYSQL_USER_VALUE" "$MYSQL_DATABASE")

selected_count="$(mysql "${mysql_args[@]}" --batch --skip-column-names -e \
  "SELECT COUNT(*) FROM organizations WHERE id='${PILOT_ID}' AND preventionEnabled=1;")"
enabled_count="$(mysql "${mysql_args[@]}" --batch --skip-column-names -e \
  "SELECT COUNT(*) FROM organizations WHERE preventionEnabled=1;")"
if [[ "$selected_count" != "1" || "$enabled_count" != "1" ]]; then
  echo "Refusing deactivation: the selected organization is not the unique active pilot." >&2
  exit 1
fi

mysql "${mysql_args[@]}" -e \
  "UPDATE organizations SET preventionEnabled=0 WHERE id='${PILOT_ID}' AND preventionEnabled=1;"

enabled_count="$(mysql "${mysql_args[@]}" --batch --skip-column-names -e \
  "SELECT COUNT(*) FROM organizations WHERE preventionEnabled=1;")"
if [[ "$enabled_count" != "0" ]]; then
  echo "Deactivation invariant failed: expected zero enabled organizations, got $enabled_count." >&2
  exit 1
fi
echo "Prevention pilot disabled for $PILOT_ID; analytical history was preserved."
