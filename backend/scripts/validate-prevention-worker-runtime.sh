#!/usr/bin/env bash
# Validates the P3 worker runtime with disposable MySQL/Redis containers.
# Run from backend/: bash scripts/validate-prevention-worker-runtime.sh
set -Eeuo pipefail

readonly MYSQL_CONTAINER="prevention-worker-mysql-$RANDOM-$$"
readonly REDIS_CONTAINER="prevention-worker-redis-$RANDOM-$$"
readonly MYSQL_PASSWORD="validation-only-not-a-secret"
WORKER_PID=''

cleanup() {
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill -TERM "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  docker rm -f "$MYSQL_CONTAINER" "$REDIS_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "VALIDATION FAILED: $*" >&2
  exit 1
}

docker run --rm -d --name "$MYSQL_CONTAINER" \
  -e MYSQL_ROOT_PASSWORD="$MYSQL_PASSWORD" -e MYSQL_DATABASE=prevention_worker_validation \
  -p 127.0.0.1::3306 mysql:8 >/dev/null
docker run --rm -d --name "$REDIS_CONTAINER" \
  -p 127.0.0.1::6379 redis:7-alpine \
  redis-server --appendonly yes --maxmemory-policy noeviction >/dev/null

for _ in $(seq 1 60); do
  docker exec "$MYSQL_CONTAINER" mysqladmin --protocol=TCP -uroot "-p$MYSQL_PASSWORD" ping --silent >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$MYSQL_CONTAINER" mysqladmin --protocol=TCP -uroot "-p$MYSQL_PASSWORD" ping --silent >/dev/null 2>&1 \
  || fail 'MySQL did not become ready'
for _ in $(seq 1 30); do
  docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG && break
  sleep 1
done
docker exec "$REDIS_CONTAINER" redis-cli ping | grep -q PONG || fail 'Redis did not become ready'

readonly WORKER_TEST_MYSQL_PORT="$(docker port "$MYSQL_CONTAINER" 3306/tcp | sed 's/.*://')"
readonly WORKER_TEST_REDIS_PORT="$(docker port "$REDIS_CONTAINER" 6379/tcp | sed 's/.*://')"

PREVENTION_REDIS_PORT="$WORKER_TEST_REDIS_PORT" node <<'NODE'
const { Queue } = require('bullmq');
(async () => {
  const queue = new Queue('prevention', {
    connection: { host: '127.0.0.1', port: Number(process.env.PREVENTION_REDIS_PORT) },
  });
  await queue.add(
    'prevention.report.upsert',
    { eventId: 'p3-must-remain', organizationId: 'org-a', reportId: 'report-a' },
    { jobId: 'p3-must-remain', delay: 120000 },
  );
  await queue.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE

set -a
. "$BACKEND_DIR/.env.example"
set +a
NODE_ENV=test \
DATABASE_HOST=127.0.0.1 DATABASE_PORT="$WORKER_TEST_MYSQL_PORT" DATABASE_USER=root \
DATABASE_PASSWORD="$MYSQL_PASSWORD" DATABASE_NAME=prevention_worker_validation \
REDIS_HOST=127.0.0.1 REDIS_PORT="$WORKER_TEST_REDIS_PORT" REDIS_DB=0 REDIS_TLS=false \
PREVENTION_WORKER_STARTUP_ATTEMPTS=3 PREVENTION_WORKER_STARTUP_DELAY_MS=250 \
PREVENTION_CONSUMER_ENABLED=false \
node dist/workers/prevention.worker.js &
WORKER_PID=$!

for _ in $(seq 1 20); do
  kill -0 "$WORKER_PID" >/dev/null 2>&1 || fail 'worker exited during bootstrap'
  sleep 0.25
done

PREVENTION_REDIS_PORT="$WORKER_TEST_REDIS_PORT" node <<'NODE'
const assert = require('node:assert/strict');
const { Queue } = require('bullmq');
(async () => {
  const queue = new Queue('prevention', {
    connection: { host: '127.0.0.1', port: Number(process.env.PREVENTION_REDIS_PORT) },
  });
  const job = await queue.getJob('p3-must-remain');
  assert.ok(job, 'P2 job must still exist');
  assert.equal(await job.getState(), 'delayed');
  await queue.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE

kill -TERM "$WORKER_PID"
for _ in $(seq 1 40); do
  kill -0 "$WORKER_PID" >/dev/null 2>&1 || break
  sleep 0.25
done
if kill -0 "$WORKER_PID" >/dev/null 2>&1; then
  fail 'worker did not stop after SIGTERM'
fi
set +e
wait "$WORKER_PID"
readonly WORKER_EXIT=$?
set -e
if [[ "$WORKER_EXIT" -ne 0 && "$WORKER_EXIT" -ne 130 && "$WORKER_EXIT" -ne 143 ]]; then
  fail "worker exited with unexpected status $WORKER_EXIT"
fi
WORKER_PID=''

echo 'VALIDATION PASSED: worker starts independently, preserves P2 jobs and stops cleanly.'
