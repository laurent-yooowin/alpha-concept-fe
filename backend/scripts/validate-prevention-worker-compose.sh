#!/usr/bin/env bash
# Validates that P3 worker services are independent and publish no ports.
# Run from repository root: bash backend/scripts/validate-prevention-worker-compose.sh
set -Eeuo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

validate_compose() {
  local file="$1" service="$2"
  local json
  json="$(cd "$ROOT_DIR" && REDIS_PASSWORD='validation-only-not-a-secret' docker compose -f "$file" config --format json)"
  COMPOSE_JSON="$json" WORKER_SERVICE="$service" node <<'NODE'
const assert = require('node:assert/strict');
const config = JSON.parse(process.env.COMPOSE_JSON);
const service = config.services[process.env.WORKER_SERVICE];
assert.ok(service, `missing service ${process.env.WORKER_SERVICE}`);
assert.ok(String(service.command).includes('prevention-worker') || String(service.command).includes('prevention.worker'));
assert.ok(!service.ports || service.ports.length === 0, 'worker must publish no ports');
assert.ok(service.networks && Object.keys(service.networks).length > 0, 'worker requires an internal network');
NODE
  echo "ok - $file: $service has an independent command and no published port"
}

validate_compose docker-compose.yml prevention-worker
validate_compose docker-compose.dev.yml prevention-worker-dev
validate_compose docker-compose.prod.yml prevention-worker

echo 'VALIDATION PASSED: all Compose worker services are internal and independently runnable.'
