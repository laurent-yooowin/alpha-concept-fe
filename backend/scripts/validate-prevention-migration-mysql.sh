#!/usr/bin/env bash
# Validates the P1 prevention migration against a disposable MySQL 8 instance.
# Run from backend/: bash scripts/validate-prevention-migration-mysql.sh
set -Eeuo pipefail

readonly CONTAINER="prevention-migration-validation-$RANDOM-$$"
readonly DATABASE="prevention_validation"
readonly MYSQL_PASSWORD="validation-only-not-a-secret"
readonly BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

readonly DATA_SOURCE_FILE="$(mktemp "$BACKEND_DIR/.prevention-migration-data-source.XXXXXX.ts")"

cleanup() {
  rm -f "$DATA_SOURCE_FILE"
  # Deliberately target only the container created by this process; no volumes are used.
  if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER" >/dev/null
  fi
}
trap cleanup EXIT

fail() {
  echo "VALIDATION FAILED: $*" >&2
  exit 1
}

mysql_exec() {
  docker exec -i "$CONTAINER" mysql --protocol=TCP -uroot "-p$MYSQL_PASSWORD" "$@" "$DATABASE"
}

expect_failure() {
  local description="$1"
  local sql="$2"
  if printf '%s\n' "$sql" | mysql_exec >/dev/null 2>&1; then
    fail "expected rejection: $description"
  fi
  echo "ok - rejected: $description"
}

expect_scalar() {
  local description="$1"
  local expected="$2"
  local sql="$3"
  local actual
  actual="$(printf '%s\n' "$sql" | mysql_exec --batch --skip-column-names | tr -d '\r')"
  [[ "$actual" == "$expected" ]] || fail "$description (expected '$expected', got '$actual')"
  echo "ok - $description"
}

echo "Starting isolated MySQL 8 container: $CONTAINER"
docker run --rm -d --name "$CONTAINER" \
  -e MYSQL_ROOT_PASSWORD="$MYSQL_PASSWORD" \
  -e MYSQL_DATABASE="$DATABASE" \
  -p 127.0.0.1::3306 mysql:8 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" mysqladmin --protocol=TCP -uroot "-p$MYSQL_PASSWORD" ping --silent >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" mysqladmin --protocol=TCP -uroot "-p$MYSQL_PASSWORD" ping --silent >/dev/null 2>&1 \
  || fail 'MySQL did not become ready'

# Minimal P1 baseline only. The P1 migration itself must install its tenant-aware
# source indexes; the baseline deliberately contains only historic primary keys.
mysql_exec <<'SQL'
CREATE TABLE organizations (
  id varchar(36) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY UQ_organizations_id (id)
) ENGINE=InnoDB;
CREATE TABLE reports (
  id varchar(36) NOT NULL,
  organizationId varchar(36) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
CREATE TABLE visits (
  id varchar(36) NOT NULL,
  organizationId varchar(36) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
CREATE TABLE missions (
  id varchar(36) NOT NULL,
  organizationId varchar(36) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
INSERT INTO organizations (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');
INSERT INTO reports (id, organizationId) VALUES
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2');
INSERT INTO visits (id, organizationId) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2');
INSERT INTO missions (id, organizationId) VALUES
  ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2');
SQL

cat > "$DATA_SOURCE_FILE" <<EOF
import { DataSource } from 'typeorm';
import { PreventionDataFoundation1830000009000 } from './src/migrations/1830000009000-prevention-data-foundation';

export default new DataSource({
  type: 'mysql', host: '127.0.0.1', port: Number(process.env.PREVENTION_MYSQL_PORT),
  username: 'root', password: '$MYSQL_PASSWORD', database: '$DATABASE',
  migrations: [PreventionDataFoundation1830000009000], synchronize: false, logging: false,
});
EOF

readonly PORT="$(docker port "$CONTAINER" 3306/tcp | sed 's/.*://')"
run_migration() {
  (cd "$BACKEND_DIR" && PREVENTION_MYSQL_PORT="$PORT" \
    ./node_modules/.bin/typeorm-ts-node-commonjs "$1" -d "$DATA_SOURCE_FILE")
}

echo 'Running migration up -> down -> up through the TypeORM CLI'
run_migration migration:run
run_migration migration:revert
expect_scalar 'down removed all P1 tables' '0' \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DATABASE' AND table_name LIKE 'prevention_%';"
expect_scalar 'down removed P1 source tenant indexes' '0' \
  "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = '$DATABASE' AND index_name IN ('UQ_reports_org_id', 'UQ_visits_org_id', 'UQ_missions_org_id');"
run_migration migration:run

expect_scalar 'all four P1 tables exist' '4' \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DATABASE' AND table_name IN ('prevention_categories','prevention_report_snapshots','prevention_findings','prevention_daily_statistics');"
expect_scalar 'every P1 organizationId is NOT NULL' '0' \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '$DATABASE' AND table_name LIKE 'prevention_%' AND column_name = 'organizationId' AND is_nullable <> 'NO';"
expect_scalar 'no excluded sensitive column is present' '0' \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '$DATABASE' AND table_name LIKE 'prevention_%' AND (column_name LIKE '%photo%' OR column_name LIKE '%directive%' OR column_name LIKE '%prompt%');"

expect_scalar 'P1 created all three source tenant indexes' '3' \
  "SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema = '$DATABASE' AND index_name IN ('UQ_reports_org_id', 'UQ_visits_org_id', 'UQ_missions_org_id');"
expect_scalar 'all seven tenant-aware composite foreign keys exist' '7' \
  "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema = '$DATABASE' AND constraint_name IN ('FK_prevention_report_snapshots_report', 'FK_prevention_report_snapshots_visit', 'FK_prevention_report_snapshots_mission', 'FK_prevention_findings_snapshot', 'FK_prevention_findings_report', 'FK_prevention_findings_visit', 'FK_prevention_findings_mission');"
expect_scalar 'all five tenant-protection triggers exist' '5' \
  "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = '$DATABASE' AND trigger_name IN ('TRG_prev_category_org_immutable_bu', 'TRG_prev_find_cat_tenant_bi', 'TRG_prev_find_cat_tenant_bu', 'TRG_prev_stat_cat_tenant_bi', 'TRG_prev_stat_cat_tenant_bu');"

mysql_exec <<'SQL'
INSERT INTO prevention_categories (id, organizationId, code, label) VALUES
  ('40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'FALL', 'Fall prevention'),
  ('40000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'FALL', 'Fall prevention B');
INSERT INTO prevention_report_snapshots (id, organizationId, reportId, visitId, missionId, sourceHash, sourceUpdatedAt, businessDate, missionType, indexedAt) VALUES
  ('50000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', REPEAT('a', 64), NOW(6), '2026-01-01', 'inspection', NOW(6));
INSERT INTO prevention_findings (id, organizationId, snapshotId, reportId, visitId, missionId, sourceKind, findingType, categoryId, normalizedKey, content, riskLevel, businessDate, missionType) VALUES
  ('60000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', 'PHOTO_GROUP', 'OBSERVATION', '40000000-0000-0000-0000-0000000000a1', REPEAT('b', 64), 'Derived analytical finding only', 'moyen', '2026-01-01', 'inspection');
INSERT INTO prevention_daily_statistics (id, organizationId, statDate, missionType, categoryId, categoryKey, riskLevel, findingType, calculatedAt) VALUES
  ('70000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '2026-01-01', 'inspection', '40000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'moyen', 'OBSERVATION', NOW(6));
SQL

expect_failure 'duplicate category code in one tenant' \
  "INSERT INTO prevention_categories (id, organizationId, code, label) VALUES ('40000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'FALL', 'Duplicate');"
expect_failure 'duplicate snapshot for a tenant report' \
  "INSERT INTO prevention_report_snapshots (id, organizationId, reportId, visitId, missionId, sourceHash, sourceUpdatedAt, businessDate, missionType, indexedAt) VALUES ('50000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', REPEAT('c',64), NOW(6), '2026-01-01', 'inspection', NOW(6));"
expect_failure 'P1 row without a tenant' \
  "INSERT INTO prevention_categories (id, organizationId, code, label) VALUES ('40000000-0000-0000-0000-0000000000a3', NULL, 'NONE', 'No tenant');"
expect_failure 'snapshot may not reference another tenant report' \
  "INSERT INTO prevention_report_snapshots (id, organizationId, reportId, visitId, missionId, sourceHash, sourceUpdatedAt, businessDate, missionType, indexedAt) VALUES ('50000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', REPEAT('d',64), NOW(6), '2026-01-01', 'inspection', NOW(6));"
expect_failure 'finding may not reference another tenant category' \
  "INSERT INTO prevention_findings (id, organizationId, snapshotId, reportId, visitId, missionId, sourceKind, findingType, categoryId, normalizedKey, content, riskLevel, businessDate, missionType) VALUES ('60000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', 'PHOTO_GROUP', 'OBSERVATION', '40000000-0000-0000-0000-0000000000b2', REPEAT('e',64), 'Cross tenant category', 'moyen', '2026-01-01', 'inspection');"
expect_failure 'daily statistic may not reference another tenant category' \
  "INSERT INTO prevention_daily_statistics (id, organizationId, statDate, missionType, categoryId, categoryKey, riskLevel, findingType, calculatedAt) VALUES ('70000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '2026-01-02', 'inspection', '40000000-0000-0000-0000-0000000000b2', '40000000-0000-0000-0000-0000000000b2', 'moyen', 'OBSERVATION', NOW(6));"
expect_failure 'referenced category organization cannot change' \
  "UPDATE prevention_categories SET organizationId = '00000000-0000-0000-0000-0000000000b2' WHERE id = '40000000-0000-0000-0000-0000000000a1';"
expect_failure 'daily statistic counters cannot be negative' \
  "INSERT INTO prevention_daily_statistics (id, organizationId, statDate, missionType, categoryKey, riskLevel, findingType, findingCount, calculatedAt) VALUES ('70000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '2026-01-02', 'inspection', 'UNCATEGORIZED', 'moyen', 'OBSERVATION', -1, NOW(6));"

mysql_exec <<'SQL'
DELETE FROM prevention_categories WHERE id = '40000000-0000-0000-0000-0000000000a1';
SQL
expect_scalar 'category deletion sets finding categoryId to NULL' '1' \
  "SELECT COUNT(*) FROM prevention_findings WHERE id = '60000000-0000-0000-0000-0000000000a1' AND categoryId IS NULL;"
expect_scalar 'category deletion sets statistic categoryId to NULL' '1' \
  "SELECT COUNT(*) FROM prevention_daily_statistics WHERE id = '70000000-0000-0000-0000-0000000000a1' AND categoryId IS NULL;"

mysql_exec <<'SQL'
DELETE FROM reports WHERE id = '10000000-0000-0000-0000-0000000000a1';
SQL
expect_scalar 'report deletion cascades to snapshot and finding' '0' \
  "SELECT (SELECT COUNT(*) FROM prevention_report_snapshots) + (SELECT COUNT(*) FROM prevention_findings);"

echo 'VALIDATION PASSED: prevention migration up/down/up and P1 constraints verified.'
