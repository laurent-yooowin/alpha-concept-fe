#!/usr/bin/env bash
# Enable Prevention for exactly one explicitly selected active organization.
# Required environment: MYSQL_DATABASE. Optional: MYSQL_HOST, MYSQL_PORT,
# MYSQL_USER, MYSQL_PASSWORD (prefer MYSQL_PWD in CI to avoid CLI exposure).
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

pilot_count="$(mysql "${mysql_args[@]}" --batch --skip-column-names -e \
  "SELECT COUNT(*) FROM organizations WHERE id='${PILOT_ID}' AND isActive=1;")"
if [[ "$pilot_count" != "1" ]]; then
  echo "Refusing activation: selected organization is missing or inactive." >&2
  exit 1
fi

mysql "${mysql_args[@]}" <<SQL
START TRANSACTION;
UPDATE organizations SET preventionEnabled=0 WHERE preventionEnabled=1;
UPDATE organizations SET preventionEnabled=1 WHERE id='${PILOT_ID}' AND isActive=1;
COMMIT;
SQL

enabled_count="$(mysql "${mysql_args[@]}" --batch --skip-column-names -e \
  "SELECT COUNT(*) FROM organizations WHERE preventionEnabled=1;")"
if [[ "$enabled_count" != "1" ]]; then
  echo "Activation invariant failed: expected exactly one enabled organization, got $enabled_count." >&2
  exit 1
fi
echo "Prevention pilot activated for $PILOT_ID; enabled organizations: $enabled_count"
