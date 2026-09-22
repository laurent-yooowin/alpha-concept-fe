#!/usr/bin/env bash
# Validates the P2 outbox migration and BullMQ idempotency with disposable containers.
# Run from backend/: bash scripts/validate-prevention-outbox-mysql-redis.sh
set -Eeuo pipefail

readonly MYSQL_CONTAINER="prevention-outbox-mysql-$RANDOM-$$"
readonly REDIS_CONTAINER="prevention-outbox-redis-$RANDOM-$$"
readonly DATABASE="prevention_outbox_validation"
readonly MYSQL_PASSWORD="validation-only-not-a-secret"
readonly BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DATA_SOURCE_FILE="$(mktemp "$BACKEND_DIR/.prevention-outbox-data-source.XXXXXX.ts")"

cleanup() {
  rm -f "$DATA_SOURCE_FILE"
  docker rm -f "$MYSQL_CONTAINER" "$REDIS_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "VALIDATION FAILED: $*" >&2
  exit 1
}

mysql_exec() {
  docker exec -i "$MYSQL_CONTAINER" mysql --protocol=TCP -uroot "-p$MYSQL_PASSWORD" "$@" "$DATABASE"
}

expect_scalar() {
  local description="$1" expected="$2" sql="$3" actual
  actual="$(printf '%s\n' "$sql" | mysql_exec --batch --skip-column-names | tr -d '\r')"
  [[ "$actual" == "$expected" ]] || fail "$description (expected '$expected', got '$actual')"
  echo "ok - $description"
}

expect_failure() {
  local description="$1" sql="$2"
  if printf '%s\n' "$sql" | mysql_exec >/dev/null 2>&1; then
    fail "expected rejection: $description"
  fi
  echo "ok - rejected: $description"
}

docker run --rm -d --name "$MYSQL_CONTAINER" \
  -e MYSQL_ROOT_PASSWORD="$MYSQL_PASSWORD" -e MYSQL_DATABASE="$DATABASE" \
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

mysql_exec <<'SQL'
CREATE TABLE organizations (id varchar(36) NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB;
INSERT INTO organizations (id) VALUES ('00000000-0000-0000-0000-0000000000a1');
SQL

cat > "$DATA_SOURCE_FILE" <<EOF
import { DataSource } from 'typeorm';
import { PreventionOutbox1830000010000 } from './src/migrations/1830000010000-prevention-outbox';
export default new DataSource({
  type: 'mysql', host: '127.0.0.1', port: Number(process.env.PREVENTION_MYSQL_PORT),
  username: 'root', password: '$MYSQL_PASSWORD', database: '$DATABASE',
  migrations: [PreventionOutbox1830000010000], synchronize: false, logging: false,
});
EOF

readonly MYSQL_PORT="$(docker port "$MYSQL_CONTAINER" 3306/tcp | sed 's/.*://')"
run_migration() {
  (cd "$BACKEND_DIR" && PREVENTION_MYSQL_PORT="$MYSQL_PORT" \
    ./node_modules/.bin/typeorm-ts-node-commonjs "$1" -d "$DATA_SOURCE_FILE")
}

run_migration migration:run
run_migration migration:revert
expect_scalar 'down removed the P2 outbox table' '0' \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DATABASE' AND table_name='prevention_outbox_events';"
run_migration migration:run
expect_scalar 'outbox table exists' '1' \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DATABASE' AND table_name='prevention_outbox_events';"
expect_scalar 'organization tenant is mandatory' '0' \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DATABASE' AND table_name='prevention_outbox_events' AND column_name='organizationId' AND is_nullable<>'NO';"
expect_scalar 'outbox contains no source-content columns' '0' \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DATABASE' AND table_name='prevention_outbox_events' AND (column_name LIKE '%photo%' OR column_name LIKE '%directive%' OR column_name LIKE '%prompt%' OR column_name='content');"

readonly INSERT_EVENT="INSERT INTO prevention_outbox_events (id,organizationId,aggregateType,aggregateId,eventType,aggregateVersion,deduplicationKey,payload,availableAt) VALUES ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','REPORT','20000000-0000-0000-0000-0000000000a1','REPORT_UPSERTED','v1','report:org:report:REPORT_UPSERTED:v1',JSON_OBJECT('eventId','10000000-0000-0000-0000-0000000000a1','organizationId','00000000-0000-0000-0000-0000000000a1','reportId','20000000-0000-0000-0000-0000000000a1','eventType','REPORT_UPSERTED','aggregateVersion','v1','occurredAt','2026-08-19T10:00:00.000Z'),NOW(6));"
printf '%s\n' "$INSERT_EVENT" | mysql_exec
expect_failure 'duplicate logical event' "${INSERT_EVENT/10000000-0000-0000-0000-0000000000a1/10000000-0000-0000-0000-0000000000a2}"
expect_failure 'event without tenant' \
  "INSERT INTO prevention_outbox_events (id,organizationId,aggregateType,aggregateId,eventType,aggregateVersion,deduplicationKey,payload,availableAt) VALUES ('30000000-0000-0000-0000-0000000000a1',NULL,'REPORT','r','REPORT_UPSERTED','v','null-tenant',JSON_OBJECT(),NOW(6));"
expect_failure 'event for an unknown tenant' \
  "INSERT INTO prevention_outbox_events (id,organizationId,aggregateType,aggregateId,eventType,aggregateVersion,deduplicationKey,payload,availableAt) VALUES ('30000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2','REPORT','r','REPORT_UPSERTED','v','unknown-tenant',JSON_OBJECT(),NOW(6));"
mysql_exec -e "DELETE FROM organizations WHERE id='00000000-0000-0000-0000-0000000000a1';"
expect_scalar 'organization deletion cascades to outbox' '0' 'SELECT COUNT(*) FROM prevention_outbox_events;'

mysql_exec <<'SQL'
INSERT INTO organizations (id) VALUES ('00000000-0000-0000-0000-0000000000a1');
CREATE TABLE report_mutation_probe (id varchar(36) NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB;
SQL

readonly REDIS_PORT="$(docker port "$REDIS_CONTAINER" 6379/tcp | sed 's/.*://')"
(cd "$BACKEND_DIR" && PREVENTION_REDIS_PORT="$REDIS_PORT" node <<'NODE'
const assert = require('node:assert/strict');
const { Queue } = require('bullmq');
const crypto = require('node:crypto');
(async () => {
  const queue = new Queue('prevention-validation', {
    connection: { host: '127.0.0.1', port: Number(process.env.PREVENTION_REDIS_PORT) },
  });
  const key = 'report:org-a:report-a:REPORT_UPSERTED:v1';
  const jobId = `prevention-${crypto.createHash('sha256').update(key).digest('hex')}`;
  await queue.add('prevention.report.upsert', { eventId: 'first' }, { jobId, delay: 120000 });
  await queue.add('prevention.report.upsert', { eventId: 'second' }, { jobId, delay: 120000 });
  const jobs = await queue.getDelayed();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, jobId);
  assert.equal(jobs[0].data.eventId, 'first');
  await queue.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
)

(cd "$BACKEND_DIR" && \
  PREVENTION_MYSQL_PORT="$MYSQL_PORT" PREVENTION_REDIS_PORT="$REDIS_PORT" \
  node -r ts-node/register <<'NODE'
const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const { Queue } = require('bullmq');
const { Redis } = require('ioredis');
const { PreventionOutboxService } = require('./src/prevention/outbox/prevention-outbox.service');
const {
  PreventionOutboxEvent,
  PreventionOutboxStatus,
} = require('./src/prevention/outbox/prevention-outbox.entity');
const { PreventionQueueService } = require('./src/prevention/queue/prevention-queue.service');

const mysqlOptions = {
  type: 'mysql', host: '127.0.0.1', port: Number(process.env.PREVENTION_MYSQL_PORT),
  username: 'root', password: 'validation-only-not-a-secret',
  database: 'prevention_outbox_validation',
  entities: [`${process.cwd()}/src/**/*.entity.ts`], synchronize: false, logging: false,
};
const redisOptions = {
  host: '127.0.0.1', port: Number(process.env.PREVENTION_REDIS_PORT),
  maxRetriesPerRequest: null, enableReadyCheck: false,
};
const config = {
  get(key, fallback) {
    if (key === 'PREVENTION_PUBLISHER_BATCH_SIZE') return 25;
    return fallback;
  },
};

(async () => {
  const dataSource = new DataSource(mysqlOptions);
  await dataSource.initialize();
  const outbox = new PreventionOutboxService();

  try {
    await dataSource.transaction(async (manager) => {
      await manager.query('INSERT INTO report_mutation_probe (id) VALUES (?)', ['rollback-report']);
      await outbox.enqueueReportEvent(manager, {
        organizationId: '00000000-0000-0000-0000-0000000000a1',
        reportId: 'rollback-report', eventType: 'REPORT_UPSERTED', aggregateVersion: 'v1',
      });
      throw new Error('intentional rollback');
    });
  } catch (error) {
    assert.equal(error.message, 'intentional rollback');
  }
  assert.equal(
    Number((await dataSource.query("SELECT COUNT(*) count FROM report_mutation_probe WHERE id='rollback-report'"))[0].count),
    0,
  );
  assert.equal(
    Number((await dataSource.query("SELECT COUNT(*) count FROM prevention_outbox_events WHERE aggregateId='rollback-report'"))[0].count),
    0,
  );

  await dataSource.transaction(async (manager) => {
    await manager.query('INSERT INTO report_mutation_probe (id) VALUES (?)', ['committed-report']);
    await outbox.enqueueReportEvent(manager, {
      organizationId: '00000000-0000-0000-0000-0000000000a1',
      reportId: 'committed-report', eventType: 'REPORT_UPSERTED', aggregateVersion: 'v1',
    });
  });
  assert.equal(
    Number((await dataSource.query("SELECT COUNT(*) count FROM prevention_outbox_events WHERE aggregateId='committed-report'"))[0].count),
    1,
  );
  await dataSource.transaction(async (manager) => {
    await outbox.enqueueReportEvent(manager, {
      organizationId: '00000000-0000-0000-0000-0000000000a1',
      reportId: 'committed-report', eventType: 'REPORT_DELETED', aggregateVersion: 'deleted-v1',
    });
    await manager.query('DELETE FROM report_mutation_probe WHERE id = ?', ['committed-report']);
  });
  assert.equal(
    Number((await dataSource.query("SELECT COUNT(*) count FROM prevention_outbox_events WHERE aggregateId='committed-report' AND eventType='REPORT_DELETED'"))[0].count),
    1,
  );

  const seed = async (reportId, status = PreventionOutboxStatus.PENDING, lockedAt = null) => {
    const event = await dataSource.transaction((manager) => outbox.enqueueReportEvent(manager, {
      organizationId: '00000000-0000-0000-0000-0000000000a1',
      reportId, eventType: 'REPORT_UPSERTED', aggregateVersion: 'v1',
    }));
    if (status !== PreventionOutboxStatus.PENDING) {
      await dataSource.getRepository(PreventionOutboxEvent).update(
        { id: event.id },
        { status, lockedBy: status === PreventionOutboxStatus.PROCESSING ? 'dead-api' : null },
      );
      if (lockedAt) {
        await dataSource.query(
          'UPDATE prevention_outbox_events SET lockedAt=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 10 MINUTE) WHERE id=?',
          [event.id],
        );
      }
    }
    return event;
  };
  await Promise.all(['concurrent-a', 'concurrent-b', 'concurrent-c', 'concurrent-d'].map((id) => seed(id)));

  const redis1 = new Redis(redisOptions);
  const redis2 = new Redis(redisOptions);
  const queue1 = new Queue('prevention', { connection: redis1 });
  const queue2 = new Queue('prevention', { connection: redis2 });
  const publisher1 = new PreventionQueueService(dataSource, config, queue1, redis1);
  const publisher2 = new PreventionQueueService(dataSource, config, queue2, redis2);
  await Promise.all([publisher1.publishBatch(), publisher2.publishBatch()]);
  assert.equal(
    Number((await dataSource.query("SELECT COUNT(*) count FROM prevention_outbox_events WHERE aggregateId LIKE 'concurrent-%' AND status='PUBLISHED'"))[0].count),
    4,
  );
  assert.equal((await queue1.getDelayed()).filter((job) => job.data.reportId.startsWith('concurrent-')).length, 4);

  const replay = await dataSource.getRepository(PreventionOutboxEvent).findOneByOrFail({ aggregateId: 'concurrent-a' });
  await dataSource.getRepository(PreventionOutboxEvent).update(
    { id: replay.id },
    { status: PreventionOutboxStatus.PENDING, publishedAt: null, availableAt: new Date() },
  );
  await publisher1.publishBatch();
  assert.equal((await queue1.getDelayed()).filter((job) => job.data.reportId.startsWith('concurrent-')).length, 4);

  const expired = await seed(
    'expired-claim',
    PreventionOutboxStatus.PROCESSING,
    new Date(Date.now() - 10 * 60_000),
  );
  await publisher1.publishBatch();
  assert.equal(
    (await dataSource.getRepository(PreventionOutboxEvent).findOneByOrFail({ id: expired.id })).status,
    PreventionOutboxStatus.PUBLISHED,
  );

  const outage = await seed('redis-outage');
  const unavailableQueue = {
    add: async () => { const error = new Error('unavailable'); error.code = 'ECONNREFUSED'; throw error; },
  };
  const outagePublisher = new PreventionQueueService(
    dataSource, config, unavailableQueue, { quit: async () => undefined },
  );
  await outagePublisher.publishBatch();
  let outageRow = await dataSource.getRepository(PreventionOutboxEvent).findOneByOrFail({ id: outage.id });
  assert.equal(outageRow.status, PreventionOutboxStatus.PENDING);
  assert.equal(outageRow.attempts, 1);
  await dataSource.query(
    'UPDATE prevention_outbox_events SET availableAt=UTC_TIMESTAMP(6) WHERE id=?',
    [outage.id],
  );
  await publisher1.publishBatch();
  outageRow = await dataSource.getRepository(PreventionOutboxEvent).findOneByOrFail({ id: outage.id });
  assert.equal(outageRow.status, PreventionOutboxStatus.PUBLISHED);

  await publisher1.onModuleDestroy();
  await publisher2.onModuleDestroy();
  await dataSource.destroy();
  console.log('ok - transactional rollback, concurrent claims, replay, expired lock and Redis recovery');
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
)

echo 'VALIDATION PASSED: P2 outbox migration and BullMQ deduplication verified.'
