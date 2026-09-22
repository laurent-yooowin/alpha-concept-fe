#!/usr/bin/env bash
# Validates P4 extraction with disposable MySQL/Redis containers.
# Run from backend/: bash scripts/validate-prevention-extraction-runtime.sh
set -Eeuo pipefail

readonly MYSQL_CONTAINER="prevention-extraction-mysql-$RANDOM-$$"
readonly REDIS_CONTAINER="prevention-extraction-redis-$RANDOM-$$"
readonly DATABASE="prevention_extraction_validation"
readonly MYSQL_PASSWORD="validation-only-not-a-secret"
readonly BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DATA_SOURCE_FILE="$(mktemp "$BACKEND_DIR/.prevention-extraction-data-source.XXXXXX.ts")"
WORKER_PID=''

cleanup() {
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill -TERM "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$DATA_SOURCE_FILE"
  docker rm -f "$MYSQL_CONTAINER" "$REDIS_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() { echo "VALIDATION FAILED: $*" >&2; exit 1; }
mysql_exec() { docker exec -i "$MYSQL_CONTAINER" mysql --protocol=TCP -uroot "-p$MYSQL_PASSWORD" "$@" "$DATABASE"; }

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
docker exec "$MYSQL_CONTAINER" mysqladmin --protocol=TCP -uroot "-p$MYSQL_PASSWORD" ping --silent >/dev/null 2>&1 || fail 'MySQL did not become ready'
for _ in $(seq 1 30); do
  docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG && break
  sleep 1
done
docker exec "$REDIS_CONTAINER" redis-cli ping | grep -q PONG || fail 'Redis did not become ready'

mysql_exec <<'SQL'
CREATE TABLE organizations (id varchar(36) NOT NULL, isActive tinyint NOT NULL DEFAULT 1, PRIMARY KEY (id)) ENGINE=InnoDB;
CREATE TABLE reports (
  id varchar(36) NOT NULL, organizationId varchar(36) NULL,
  visitId varchar(36) NOT NULL, missionId varchar(36) NOT NULL,
  status varchar(32) NULL, updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB;
CREATE TABLE visits (
  id varchar(36) NOT NULL, organizationId varchar(36) NULL,
  missionId varchar(36) NOT NULL, visitDate datetime(6) NOT NULL, photos json NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
CREATE TABLE missions (
  id varchar(36) NOT NULL, organizationId varchar(36) NULL, type varchar(32) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
INSERT INTO organizations (id) VALUES
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');
INSERT INTO missions (id,organizationId,type) VALUES
  ('30000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','CSPS');
INSERT INTO visits (id,organizationId,missionId,visitDate,photos) VALUES (
  '20000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1',
  '30000000-0000-4000-8000-0000000000a1','2026-08-21 09:00:00.000000',
  JSON_ARRAY(
    JSON_OBJECT('id','photo-a','groupId','group-photo','uri','s3://excluded','userDirectives','excluded',
      'analysis',JSON_OBJECT('observation',JSON_ARRAY('Garde-corps endommagé\nDanger : chute\nRisque : blessure grave'),'recommendation','Réparer le garde-corps.','riskLevel','eleve','confidence',92,'references',JSON_ARRAY('R4323-59'))),
    JSON_OBJECT('id','directive-a','groupId','group-directive','isDirectiveOnly',true,'userDirectives','excluded',
      'analysis',JSON_OBJECT('observation','Cheminement non matérialisé.','recommendation',JSON_ARRAY('Matérialiser le cheminement.'),'riskLevel','moyen','confidence',85,'references','R4534-10'))
  )
);
INSERT INTO reports (id,organizationId,visitId,missionId,status) VALUES (
  '10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1',
  '20000000-0000-4000-8000-0000000000a1','30000000-0000-4000-8000-0000000000a1','brouillon'
),(
  '10000000-0000-4000-8000-0000000000c3','00000000-0000-4000-8000-0000000000a1',
  '20000000-0000-4000-8000-0000000000c3','30000000-0000-4000-8000-0000000000a1','brouillon'
);
SQL

cat > "$DATA_SOURCE_FILE" <<EOF
import { DataSource } from 'typeorm';
import { PreventionDataFoundation1830000009000 } from './src/migrations/1830000009000-prevention-data-foundation';
import { PreventionStatistics1830000011000 } from './src/migrations/1830000011000-prevention-statistics';
import { PreventionScheduler1830000012000 } from './src/migrations/1830000012000-prevention-scheduler';
export default new DataSource({
  type: 'mysql', host: '127.0.0.1', port: Number(process.env.PREVENTION_MYSQL_PORT),
  username: 'root', password: '$MYSQL_PASSWORD', database: '$DATABASE',
  migrations: [PreventionDataFoundation1830000009000, PreventionStatistics1830000011000,
    PreventionScheduler1830000012000], synchronize: false, logging: false,
});
EOF

readonly EXTRACTION_MYSQL_PORT="$(docker port "$MYSQL_CONTAINER" 3306/tcp | sed 's/.*://')"
readonly EXTRACTION_REDIS_PORT="$(docker port "$REDIS_CONTAINER" 6379/tcp | sed 's/.*://')"
(cd "$BACKEND_DIR" && PREVENTION_MYSQL_PORT="$EXTRACTION_MYSQL_PORT" \
  ./node_modules/.bin/typeorm-ts-node-commonjs migration:run -d "$DATA_SOURCE_FILE")
(cd "$BACKEND_DIR" && PREVENTION_MYSQL_PORT="$EXTRACTION_MYSQL_PORT" \
  ./node_modules/.bin/typeorm-ts-node-commonjs migration:revert -d "$DATA_SOURCE_FILE")
(cd "$BACKEND_DIR" && PREVENTION_MYSQL_PORT="$EXTRACTION_MYSQL_PORT" \
  ./node_modules/.bin/typeorm-ts-node-commonjs migration:run -d "$DATA_SOURCE_FILE")

set -a
. "$BACKEND_DIR/.env.example"
set +a
NODE_ENV=test DATABASE_HOST=127.0.0.1 DATABASE_PORT="$EXTRACTION_MYSQL_PORT" \
DATABASE_USER=root DATABASE_PASSWORD="$MYSQL_PASSWORD" DATABASE_NAME="$DATABASE" \
REDIS_HOST=127.0.0.1 REDIS_PORT="$EXTRACTION_REDIS_PORT" REDIS_DB=0 REDIS_TLS=false \
PREVENTION_WORKER_CONCURRENCY=2 PREVENTION_WORKER_STARTUP_ATTEMPTS=3 \
PREVENTION_WORKER_STARTUP_DELAY_MS=250 node dist/workers/prevention.worker.js &
WORKER_PID=$!
sleep 3
kill -0 "$WORKER_PID" >/dev/null 2>&1 || fail 'worker exited during bootstrap'

(cd "$BACKEND_DIR" && \
  PREVENTION_MYSQL_PORT="$EXTRACTION_MYSQL_PORT" PREVENTION_REDIS_PORT="$EXTRACTION_REDIS_PORT" \
  node -r ts-node/register <<'NODE'
const assert = require('node:assert/strict');
const { Queue } = require('bullmq');
const { DataSource } = require('typeorm');
const { ConfigService } = require('@nestjs/config');
const { PreventionExtractionService } = require('./src/prevention/extraction/prevention-extraction.service');
const { loadScoreConfiguration, scoreConfigurationFingerprint } = require('./src/prevention/statistics/prevention-score.config');
const { PREVENTION_DIFFERENTIAL_JOB, PREVENTION_CONSOLIDATION_JOB } = require('./src/prevention/scheduler/prevention-scheduler.types');

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';
const REPORT = '10000000-0000-4000-8000-0000000000a1';
const mysql = new DataSource({
  type: 'mysql', host: '127.0.0.1', port: Number(process.env.PREVENTION_MYSQL_PORT),
  username: 'root', password: 'validation-only-not-a-secret',
  database: 'prevention_extraction_validation',
  entities: [`${process.cwd()}/src/**/*.entity.ts`], synchronize: false, logging: false,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const payload = (eventId, organizationId, eventType = 'REPORT_UPSERTED') => ({
  eventId, organizationId, reportId: REPORT, eventType,
  aggregateVersion: eventId, occurredAt: '2026-08-21T10:00:00.000Z',
});

(async () => {
  await mysql.initialize();
  const queue = new Queue('prevention', {
    connection: { host: '127.0.0.1', port: Number(process.env.PREVENTION_REDIS_PORT) },
  });
  const schedulers = await queue.getJobSchedulers(0, 20, true);
  assert.equal(schedulers.length, 5);
  assert.ok(schedulers.every((scheduler) => scheduler.tz === 'Europe/Paris'));
  const tenantRunId = '81000000-0000-4000-8000-000000000001';
  const tenantCheckpointId = '82000000-0000-4000-8000-000000000001';
  await mysql.query(
    `INSERT INTO prevention_scheduler_runs
      (id,jobType,scheduledFor,status,availableAt)
     VALUES (?, 'validation', '2026-08-20 00:00:00.000000', 'PENDING', UTC_TIMESTAMP(6))`,
    [tenantRunId],
  );
  await mysql.query(
    `INSERT INTO prevention_scheduler_checkpoints (id,runId,organizationId,status)
     VALUES (?,?,?,'PENDING')`,
    [tenantCheckpointId, tenantRunId, ORG_A],
  );
  await assert.rejects(
    () => mysql.query(
      `INSERT INTO prevention_scheduler_tasks
        (id,checkpointId,organizationId,reportId,status)
       VALUES ('83000000-0000-4000-8000-000000000001',?,?,?,'PENDING')`,
      [tenantCheckpointId, ORG_B, REPORT],
    ),
    /foreign key constraint fails/i,
  );
  await mysql.query('DELETE FROM prevention_scheduler_runs WHERE id=?', [tenantRunId]);
  const waitJob = async (job) => {
    for (let i = 0; i < 80; i += 1) {
      const state = await job.getState();
      if (state === 'completed') return;
      if (state === 'failed') {
        const current = await queue.getJob(job.id);
        throw new Error(`job failed: ${job.id} ${current?.failedReason ?? job.failedReason}`);
      }
      await sleep(100);
    }
    throw new Error(`job timeout: ${job.id}`);
  };
  const add = (name, data) => queue.add(name, data, { jobId: data.eventId, attempts: 1 });
  const waitStatistics = async () => {
    for (let i = 0; i < 100; i += 1) {
      const [row] = await mysql.query(
        `SELECT
          (SELECT COUNT(*) FROM prevention_statistics_partitions WHERE organizationId=?) +
          (SELECT COUNT(*) FROM prevention_score_partitions WHERE organizationId=?) count`,
        [ORG_A, ORG_A],
      );
      if (Number(row.count) === 0) return;
      await sleep(100);
    }
    const failed = await queue.getFailed(0, 10);
    const completed = await queue.getCompleted(0, 10);
    const waiting = await queue.getWaiting(0, 10);
    const active = await queue.getActive(0, 10);
    const delayed = await queue.getDelayed(0, 10);
    const dirty = await mysql.query(
      'SELECT id,status,version,lastError FROM prevention_statistics_partitions WHERE organizationId=?',
      [ORG_A],
    );
    throw new Error(`statistics refresh timeout failed=${JSON.stringify(failed.map((job) => ({
      id: job.id, name: job.name, reason: job.failedReason,
    })))} completed=${JSON.stringify(completed.map((job) => ({ id: job.id, name: job.name, result: job.returnvalue })))} waiting=${JSON.stringify(waiting.map((job) => job.name))} active=${JSON.stringify(active.map((job) => job.name))} delayed=${JSON.stringify(delayed.map((job) => ({ name: job.name, reason: job.failedReason, attempts: job.attemptsMade })))} dirty=${JSON.stringify(dirty)}`);
  };
  const waitSchedulerRun = async (jobType, scheduledFor) => {
    for (let i = 0; i < 120; i += 1) {
      const [run] = await mysql.query(
        'SELECT status,processedOrganizations FROM prevention_scheduler_runs WHERE jobType=? AND scheduledFor=?',
        [jobType, scheduledFor],
      );
      if (run?.status === 'COMPLETED') return run;
      await sleep(100);
    }
    const runs = await mysql.query('SELECT * FROM prevention_scheduler_runs WHERE jobType=?', [jobType]);
    const checkpoints = await mysql.query(
      `SELECT c.* FROM prevention_scheduler_checkpoints c JOIN prevention_scheduler_runs r ON r.id=c.runId
       WHERE r.jobType=?`, [jobType]);
    const failed = await queue.getFailed(0, 20);
    throw new Error(`scheduler run timeout ${jobType} runs=${JSON.stringify(runs)} checkpoints=${JSON.stringify(checkpoints)} failed=${JSON.stringify(failed.map((job) => ({ name: job.name, reason: job.failedReason })))}`);
  };

  await waitJob(await add('prevention.report.upsert', payload('40000000-0000-4000-8000-000000000001', ORG_A)));
  await waitStatistics();
  let snapshots = await mysql.query('SELECT * FROM prevention_report_snapshots WHERE organizationId=? AND reportId=?', [ORG_A, REPORT]);
  assert.equal(snapshots.length, 1);
  let findings = await mysql.query('SELECT * FROM prevention_findings WHERE organizationId=? AND reportId=? ORDER BY sourceGroupId,findingType', [ORG_A, REPORT]);
  assert.equal(findings.length, 4);
  assert.ok(findings.some((row) => row.danger === 'chute' && row.risk === 'blessure grave'));
  assert.doesNotMatch(JSON.stringify(findings), /s3:|userDirectives|prompt/i);
  let daily = await mysql.query('SELECT * FROM prevention_daily_statistics WHERE organizationId=?', [ORG_A]);
  let scores = await mysql.query('SELECT * FROM prevention_priority_scores WHERE organizationId=?', [ORG_A]);
  assert.equal(daily.length, 4);
  assert.equal(scores.length, 4);
  assert.ok(scores.every((row) => row.configurationSource === 'ENVIRONMENT' && row.configurationId === null));
  const firstHash = snapshots[0].sourceHash;
  const firstUpdatedAt = new Date(snapshots[0].updatedAt).getTime();

  await waitJob(await add('prevention.report.upsert', payload('40000000-0000-4000-8000-000000000002', ORG_A)));
  snapshots = await mysql.query('SELECT * FROM prevention_report_snapshots WHERE organizationId=? AND reportId=?', [ORG_A, REPORT]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].sourceHash, firstHash);
  assert.equal(new Date(snapshots[0].updatedAt).getTime(), firstUpdatedAt);

  const changedPhotos = [{
    id: 'photo-a', groupId: 'group-photo', uri: 's3://still-excluded',
    analysis: { observation: ['Observation remplacée'], recommendation: ['Action remplacée'], riskLevel: 'faible', confidence: 70, references: [] },
  }];
  await mysql.query('UPDATE visits SET photos=? WHERE id=? AND organizationId=?', [JSON.stringify(changedPhotos), '20000000-0000-4000-8000-0000000000a1', ORG_A]);
  const concurrent = await Promise.all([
    add('prevention.report.upsert', payload('40000000-0000-4000-8000-000000000003', ORG_A)),
    add('prevention.report.upsert', payload('40000000-0000-4000-8000-000000000004', ORG_A)),
  ]);
  await Promise.all(concurrent.map(waitJob));
  await waitStatistics();
  snapshots = await mysql.query('SELECT * FROM prevention_report_snapshots WHERE organizationId=? AND reportId=?', [ORG_A, REPORT]);
  findings = await mysql.query('SELECT * FROM prevention_findings WHERE organizationId=? AND reportId=?', [ORG_A, REPORT]);
  assert.equal(snapshots.length, 1);
  assert.notEqual(snapshots[0].sourceHash, firstHash);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((row) => /remplacée/i.test(row.content)));
  daily = await mysql.query('SELECT * FROM prevention_daily_statistics WHERE organizationId=?', [ORG_A]);
  scores = await mysql.query('SELECT * FROM prevention_priority_scores WHERE organizationId=?', [ORG_A]);
  assert.equal(daily.length, 2);
  assert.equal(scores.length, 2);

  const dailyBeforeFailedPublication = JSON.stringify(daily);
  const scoresBeforeFailedPublication = JSON.stringify(scores);
  await mysql.query(
    `INSERT INTO prevention_statistics_partitions
      (id,organizationId,statDate,missionType,categoryKey,referenceDate,status,version,attempts,availableAt)
     VALUES (UUID(),?,?,?,?,'2026-08-22','PENDING',1,0,UTC_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,
       referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),availableAt=UTC_TIMESTAMP(6)`,
    [ORG_A, '2026-08-21', 'CSPS', 'UNCATEGORIZED'],
  );
  await mysql.query(
    `INSERT INTO prevention_score_partitions
      (id,organizationId,patternKey,missionType,categoryKey,findingType,referenceDate,status,version,availableAt)
     SELECT UUID(),organizationId,patternKey,missionType,COALESCE(categoryId,'UNCATEGORIZED'),
       findingType,'2026-08-22','PENDING',1,UTC_TIMESTAMP(6)
     FROM prevention_findings WHERE organizationId=?
     GROUP BY organizationId,patternKey,missionType,COALESCE(categoryId,'UNCATEGORIZED'),findingType
     ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,
       referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),availableAt=UTC_TIMESTAMP(6)`,
    [ORG_A],
  );
  await mysql.query(`CREATE TRIGGER TRG_p5_force_publication_rollback
    BEFORE INSERT ON prevention_priority_scores FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced statistics rollback'`);
  const failedPublicationJob = await add('prevention.statistics.refresh', {
    organizationId: ORG_A, referenceDate: '2026-08-22',
    triggerEventId: '40000000-0000-4000-8000-000000000098',
  });
  await assert.rejects(() => waitJob(failedPublicationJob), /forced statistics rollback|job failed/);
  await mysql.query('DROP TRIGGER TRG_p5_force_publication_rollback');
  daily = await mysql.query('SELECT * FROM prevention_daily_statistics WHERE organizationId=?', [ORG_A]);
  scores = await mysql.query('SELECT * FROM prevention_priority_scores WHERE organizationId=?', [ORG_A]);
  assert.equal(JSON.stringify(daily), dailyBeforeFailedPublication);
  assert.equal(JSON.stringify(scores), scoresBeforeFailedPublication);
  await waitJob(await add('prevention.statistics.refresh', {
    organizationId: ORG_A, referenceDate: '2026-08-22',
    triggerEventId: '40000000-0000-4000-8000-000000000097',
  }));
  await waitStatistics();

  const customConfiguration = loadScoreConfiguration(new ConfigService(process.env));
  customConfiguration.weights = {
    severity: 100, frequency: 0, coverage: 0, recency: 0,
    recurrence: 0, trend: 0, emergence: 0,
  };
  const customFingerprint = scoreConfigurationFingerprint(customConfiguration);
  await mysql.query(
    `INSERT INTO prevention_score_configurations
      (id,organizationId,version,source,configurationFingerprint,weights,factors,thresholds,isActive)
     VALUES (?,?,?,?,?,?,?,?,1)`,
    ['70000000-0000-4000-8000-000000000001', ORG_A, 1, 'ADMIN', customFingerprint,
      JSON.stringify(customConfiguration.weights), JSON.stringify({
        severityLow: customConfiguration.severityFactors.low,
        severityMedium: customConfiguration.severityFactors.medium,
        severityHigh: customConfiguration.severityFactors.high,
        recencyCurrent: customConfiguration.recencyCurrentFactor,
        recencyOlder: customConfiguration.recencyOlderFactor,
        recencyStale: customConfiguration.recencyStaleFactor,
      }), JSON.stringify({
        frequencyTarget: customConfiguration.frequencyTarget,
        coverageTarget: customConfiguration.coverageTarget,
        recencyRecentDays: customConfiguration.recencyRecentDays,
        recencyCurrentDays: customConfiguration.recencyCurrentDays,
        recencyOlderDays: customConfiguration.recencyOlderDays,
        recurrenceTargetDays: customConfiguration.recurrenceTargetDays,
        trendWindowDays: customConfiguration.trendWindowDays,
        emergenceDays: customConfiguration.emergenceDays,
        emergenceMinimumOccurrences: customConfiguration.emergenceMinimumOccurrences,
      })],
  );
  await mysql.query(
    `INSERT INTO prevention_statistics_partitions
      (id,organizationId,statDate,missionType,categoryKey,referenceDate,status,version,attempts,availableAt)
     VALUES (UUID(),?,?,?,?,'2026-08-23','PENDING',1,0,UTC_TIMESTAMP(6))`,
    [ORG_A, '2026-08-21', 'CSPS', 'UNCATEGORIZED'],
  );
  await mysql.query(
    `INSERT INTO prevention_score_partitions
      (id,organizationId,patternKey,missionType,categoryKey,findingType,referenceDate,status,version,availableAt)
     SELECT UUID(),organizationId,patternKey,missionType,COALESCE(categoryId,'UNCATEGORIZED'),
       findingType,'2026-08-23','PENDING',1,UTC_TIMESTAMP(6)
     FROM prevention_findings WHERE organizationId=?
     GROUP BY organizationId,patternKey,missionType,COALESCE(categoryId,'UNCATEGORIZED'),findingType`,
    [ORG_A],
  );
  await waitJob(await add('prevention.statistics.refresh', {
    organizationId: ORG_A, referenceDate: '2026-08-23',
    triggerEventId: '40000000-0000-4000-8000-000000000099',
  }));
  await waitStatistics();
  scores = await mysql.query('SELECT * FROM prevention_priority_scores WHERE organizationId=?', [ORG_A]);
  assert.ok(scores.every((row) => row.configurationSource === 'ADMIN' &&
    row.configurationId === '70000000-0000-4000-8000-000000000001' && Number(row.score) === 20));
  const calendarDate = (value) => value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);
  assert.ok(scores.every((row) => calendarDate(row.referenceDate) === '2026-08-23'));
  await assert.rejects(
    () => mysql.query(
      `INSERT INTO prevention_score_configurations
        (id,organizationId,version,source,configurationFingerprint,weights,factors,thresholds,isActive)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      ['70000000-0000-4000-8000-000000000002', ORG_A, 2, 'ADMIN', customFingerprint,
        JSON.stringify(customConfiguration.weights), JSON.stringify({
          severityLow: customConfiguration.severityFactors.low,
          severityMedium: customConfiguration.severityFactors.medium,
          severityHigh: customConfiguration.severityFactors.high,
          recencyCurrent: customConfiguration.recencyCurrentFactor,
          recencyOlder: customConfiguration.recencyOlderFactor,
          recencyStale: customConfiguration.recencyStaleFactor,
        }), JSON.stringify({
          frequencyTarget: customConfiguration.frequencyTarget,
          coverageTarget: customConfiguration.coverageTarget,
          recencyRecentDays: customConfiguration.recencyRecentDays,
          recencyCurrentDays: customConfiguration.recencyCurrentDays,
          recencyOlderDays: customConfiguration.recencyOlderDays,
          recurrenceTargetDays: customConfiguration.recurrenceTargetDays,
          trendWindowDays: customConfiguration.trendWindowDays,
          emergenceDays: customConfiguration.emergenceDays,
          emergenceMinimumOccurrences: customConfiguration.emergenceMinimumOccurrences,
        })],
    ),
    /Only one active|Duplicate entry/,
  );
  await assert.rejects(
    () => mysql.query('DELETE FROM prevention_score_configurations WHERE id=?',
      ['70000000-0000-4000-8000-000000000001']),
    /cannot be deleted/,
  );

  const extraction = new PreventionExtractionService(mysql);
  await assert.rejects(
    () => extraction.indexReport(
      ORG_A, '10000000-0000-4000-8000-0000000000c3', '2026-08-21',
    ),
    /relations are inconsistent/,
  );
  await mysql.query('DELETE FROM reports WHERE id=? AND organizationId=?',
    ['10000000-0000-4000-8000-0000000000c3', ORG_A]);

  await mysql.query('DELETE FROM prevention_daily_statistics WHERE organizationId=? LIMIT 1', [ORG_A]);
  await mysql.query('DELETE FROM prevention_priority_scores WHERE organizationId=? LIMIT 1', [ORG_A]);
  await mysql.query('UPDATE organizations SET isActive=0 WHERE id=?', [ORG_B]);
  const consolidationScheduledFor = '2026-08-24T01:00:00.000Z';
  await waitJob(await queue.add(PREVENTION_CONSOLIDATION_JOB, {
    scheduledFor: consolidationScheduledFor, cursor: null,
  }, { jobId: 'p6-validation-consolidation', attempts: 1, removeOnComplete: false }));
  await waitSchedulerRun(PREVENTION_CONSOLIDATION_JOB, consolidationScheduledFor);
  await waitStatistics();
  assert.equal(Number((await mysql.query(
    `SELECT COUNT(*) count FROM prevention_scheduler_tasks t
     JOIN prevention_scheduler_checkpoints c ON c.id=t.checkpointId
     JOIN prevention_scheduler_runs r ON r.id=c.runId
     WHERE r.jobType=? AND r.scheduledFor=? AND t.status<>'COMPLETED'`,
    [PREVENTION_CONSOLIDATION_JOB, consolidationScheduledFor]))[0].count), 0);
  assert.equal(Number((await mysql.query(
    'SELECT COUNT(*) count FROM prevention_daily_statistics WHERE organizationId=?', [ORG_A]))[0].count), 2);
  assert.equal(Number((await mysql.query(
    'SELECT COUNT(*) count FROM prevention_priority_scores WHERE organizationId=?', [ORG_A]))[0].count), 2);
  await mysql.query('UPDATE organizations SET isActive=1 WHERE id=?', [ORG_B]);

  await waitJob(await add('prevention.report.upsert', payload('40000000-0000-4000-8000-000000000005', ORG_B)));
  assert.equal(Number((await mysql.query('SELECT COUNT(*) count FROM prevention_report_snapshots WHERE organizationId=?', [ORG_B]))[0].count), 0);

  const stableHash = snapshots[0].sourceHash;
  await mysql.query(`CREATE TRIGGER TRG_p4_force_rollback BEFORE INSERT ON prevention_findings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced rollback'`);
  changedPhotos[0].analysis.observation = ['Rollback observation'];
  await mysql.query('UPDATE visits SET photos=? WHERE id=?', [JSON.stringify(changedPhotos), '20000000-0000-4000-8000-0000000000a1']);
  await assert.rejects(() => extraction.indexReport(ORG_A, REPORT, '2026-08-21'));
  await mysql.query('DROP TRIGGER TRG_p4_force_rollback');
  snapshots = await mysql.query('SELECT * FROM prevention_report_snapshots WHERE organizationId=? AND reportId=?', [ORG_A, REPORT]);
  findings = await mysql.query('SELECT * FROM prevention_findings WHERE organizationId=? AND reportId=?', [ORG_A, REPORT]);
  assert.equal(snapshots[0].sourceHash, stableHash);
  assert.equal(findings.length, 2);

  await mysql.query(
    `INSERT INTO prevention_statistics_partitions
      (id,organizationId,statDate,missionType,categoryKey,referenceDate,status,version,attempts,availableAt)
     SELECT UUID(),organizationId,businessDate,missionType,COALESCE(categoryId,'UNCATEGORIZED'),
       UTC_DATE(),'PENDING',1,0,UTC_TIMESTAMP(6)
     FROM prevention_findings WHERE organizationId=? AND reportId=?
     GROUP BY organizationId,businessDate,missionType,COALESCE(categoryId,'UNCATEGORIZED')
     ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,
       referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),availableAt=UTC_TIMESTAMP(6)`,
    [ORG_A, REPORT],
  );
  await mysql.query(
    `INSERT INTO prevention_score_partitions
      (id,organizationId,patternKey,missionType,categoryKey,findingType,referenceDate,status,version,availableAt)
     SELECT UUID(),organizationId,patternKey,missionType,COALESCE(categoryId,'UNCATEGORIZED'),
       findingType,UTC_DATE(),'PENDING',1,UTC_TIMESTAMP(6)
     FROM prevention_findings WHERE organizationId=? AND reportId=?
     GROUP BY organizationId,patternKey,missionType,COALESCE(categoryId,'UNCATEGORIZED'),findingType
     ON DUPLICATE KEY UPDATE status='PENDING',version=version+1,
       referenceDate=GREATEST(referenceDate,VALUES(referenceDate)),availableAt=UTC_TIMESTAMP(6)`,
    [ORG_A, REPORT],
  );
  await mysql.query('DELETE FROM reports WHERE id=? AND organizationId=?', [REPORT, ORG_A]);
  await waitJob(await add('prevention.report.delete', payload('40000000-0000-4000-8000-000000000006', ORG_A, 'REPORT_DELETED')));
  await waitJob(await add('prevention.report.delete', payload('40000000-0000-4000-8000-000000000007', ORG_A, 'REPORT_DELETED')));
  await waitStatistics();
  assert.equal(Number((await mysql.query('SELECT COUNT(*) count FROM prevention_report_snapshots WHERE reportId=?', [REPORT]))[0].count), 0);
  assert.equal(Number((await mysql.query('SELECT COUNT(*) count FROM prevention_findings WHERE reportId=?', [REPORT]))[0].count), 0);
  assert.equal(Number((await mysql.query('SELECT COUNT(*) count FROM prevention_daily_statistics WHERE organizationId=?', [ORG_A]))[0].count), 0);
  assert.equal(Number((await mysql.query('SELECT COUNT(*) count FROM prevention_priority_scores WHERE organizationId=?', [ORG_A]))[0].count), 0);

  const scheduledFor = '2026-08-22T00:00:00.000Z';
  await mysql.query('UPDATE organizations SET isActive=0 WHERE id=?', [ORG_B]);
  const schedulerJob = await queue.add(PREVENTION_DIFFERENTIAL_JOB,
    { scheduledFor, cursor: null }, {
      jobId: 'p6-validation-differential', attempts: 1, removeOnComplete: false,
    });
  await waitJob(schedulerJob);
  const schedulerRun = await waitSchedulerRun(PREVENTION_DIFFERENTIAL_JOB, scheduledFor);
  assert.equal(Number(schedulerRun.processedOrganizations), 1);

  await queue.close();
  await mysql.destroy();
  console.log('ok - P4/P5 pipeline and P6 scheduler, consolidation, task isolation and recovery');
})().catch((error) => {
  console.error(error);
  // The harness owns disposable MySQL/Redis resources. Exit immediately on an
  // assertion failure so open BullMQ sockets cannot hide the original error.
  process.exit(1);
});
NODE
)

kill -TERM "$WORKER_PID"
set +e
wait "$WORKER_PID"
readonly WORKER_EXIT=$?
set -e
if [[ "$WORKER_EXIT" -ne 0 && "$WORKER_EXIT" -ne 130 && "$WORKER_EXIT" -ne 143 ]]; then
  fail "worker exited with unexpected status $WORKER_EXIT"
fi
WORKER_PID=''

echo 'VALIDATION PASSED: P4/P5 pipeline and P6 scheduler are tenant-scoped, atomic and idempotent.'
