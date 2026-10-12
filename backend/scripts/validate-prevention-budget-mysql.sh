#!/usr/bin/env bash
# Validates the P8B Budget migration and tenant/integrity constraints.
# Run from backend/: bash scripts/validate-prevention-budget-mysql.sh
set -Eeuo pipefail

readonly CONTAINER="prevention-budget-validation-$RANDOM-$$"
readonly DATABASE="prevention_budget_validation"
readonly MYSQL_PASSWORD="validation-only-not-a-secret"
readonly BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DATA_SOURCE_FILE="$(mktemp "$BACKEND_DIR/.prevention-budget-data-source.XXXXXX.ts")"

cleanup() {
  rm -f "$DATA_SOURCE_FILE"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
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
  local description="$1" sql="$2"
  if printf '%s\n' "$sql" | mysql_exec >/dev/null 2>&1; then
    fail "expected rejection: $description"
  fi
  echo "ok - rejected: $description"
}

expect_scalar() {
  local description="$1" expected="$2" sql="$3" actual
  actual="$(printf '%s\n' "$sql" | mysql_exec --batch --skip-column-names | tr -d '\r')"
  [[ "$actual" == "$expected" ]] || fail "$description (expected '$expected', got '$actual')"
  echo "ok - $description"
}

docker run --rm -d --name "$CONTAINER" \
  -e MYSQL_ROOT_PASSWORD="$MYSQL_PASSWORD" -e MYSQL_DATABASE="$DATABASE" \
  -p 127.0.0.1::3306 mysql:8 >/dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" mysqladmin --protocol=TCP -uroot "-p$MYSQL_PASSWORD" ping --silent >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" mysqladmin --protocol=TCP -uroot "-p$MYSQL_PASSWORD" ping --silent >/dev/null 2>&1 \
  || fail 'MySQL did not become ready'

# Minimal historical tables required by the P8B foreign keys. Their
# composite tenant indexes deliberately model the indexes installed by P1/P3.
mysql_exec <<'SQL'
CREATE TABLE organizations (
  id varchar(36) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
CREATE TABLE reports (
  id varchar(36) NOT NULL,
  organizationId varchar(36) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY UQ_reports_org_id (organizationId, id)
) ENGINE=InnoDB;
CREATE TABLE missions (
  id varchar(36) NOT NULL,
  organizationId varchar(36) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY UQ_missions_org_id (organizationId, id)
) ENGINE=InnoDB;
CREATE TABLE prevention_categories (
  id varchar(36) NOT NULL,
  organizationId varchar(36) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY UQ_prevention_categories_org_id (organizationId, id)
) ENGINE=InnoDB;
CREATE TABLE prevention_findings (
  id varchar(36) NOT NULL,
  organizationId varchar(36) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
INSERT INTO organizations (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');
INSERT INTO reports (id, organizationId) VALUES
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2');
INSERT INTO missions (id, organizationId) VALUES
  ('11000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('11000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2');
INSERT INTO prevention_categories (id, organizationId) VALUES
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2');
INSERT INTO prevention_findings (id, organizationId) VALUES
  ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2');
SQL

cat > "$DATA_SOURCE_FILE" <<EOF
import { DataSource } from 'typeorm';
import { PreventionBudget1830000013000 } from './src/migrations/1830000013000-prevention-budget';
import { PreventionBudgetFilters1830000014000 } from './src/migrations/1830000014000-prevention-budget-filters';
import { PreventionCostCatalogAudit1830000015000 } from './src/migrations/1830000015000-prevention-cost-catalog-audit';
export default new DataSource({
  type: 'mysql', host: '127.0.0.1', port: Number(process.env.PREVENTION_MYSQL_PORT),
  username: 'root', password: '$MYSQL_PASSWORD', database: '$DATABASE',
  migrations: [PreventionBudget1830000013000, PreventionBudgetFilters1830000014000, PreventionCostCatalogAudit1830000015000], synchronize: false, logging: false,
});
EOF

readonly MYSQL_PORT="$(docker port "$CONTAINER" 3306/tcp | sed 's/.*://')"
run_migration() {
  (cd "$BACKEND_DIR" && PREVENTION_MYSQL_PORT="$MYSQL_PORT" \
    ./node_modules/.bin/typeorm-ts-node-commonjs "$1" -d "$DATA_SOURCE_FILE")
}

echo 'Running Budget migration up -> down -> up through the TypeORM CLI'
run_migration migration:run
run_migration migration:revert
run_migration migration:revert
run_migration migration:revert
expect_scalar 'down removed all seven P8B tables' '0' \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DATABASE' AND table_name IN ('prevention_cost_catalog','prevention_cost_catalog_audit','prevention_budget_scenarios','prevention_budget_reconciliation_intents','prevention_budget_items','prevention_budget_item_sources','prevention_budget_audit');"
run_migration migration:run
expect_scalar 'all seven P8B tables exist' '7' \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DATABASE' AND table_name IN ('prevention_cost_catalog','prevention_cost_catalog_audit','prevention_budget_scenarios','prevention_budget_reconciliation_intents','prevention_budget_items','prevention_budget_item_sources','prevention_budget_audit');"
expect_scalar 'all P8B organizationId columns are mandatory' '0' \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DATABASE' AND table_name IN ('prevention_cost_catalog','prevention_cost_catalog_audit','prevention_budget_scenarios','prevention_budget_reconciliation_intents','prevention_budget_items','prevention_budget_item_sources','prevention_budget_audit') AND column_name='organizationId' AND is_nullable<>'NO';"
expect_scalar 'all P8B triggers exist' '12' \
  "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='$DATABASE' AND trigger_name IN ('TRG_prev_budget_scenario_bi','TRG_prev_budget_scenario_bu','TRG_prev_budget_scenario_bd','TRG_prev_budget_catalog_bi','TRG_prev_budget_catalog_bu','TRG_prev_budget_catalog_bd','TRG_prev_budget_source_tenant_bi','TRG_prev_budget_source_tenant_bu','TRG_prev_budget_audit_bu','TRG_prev_budget_audit_bd','TRG_prev_catalog_audit_bu','TRG_prev_catalog_audit_bd');"
expect_scalar 'scenario filters are installed' '2' \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DATABASE' AND table_name='prevention_budget_scenarios' AND column_name IN ('missionId','categoryId');"

mysql_exec <<'SQL'
INSERT INTO prevention_cost_catalog (id, organizationId, version, categoryId, categoryKey, label, unit, unitCostHt, priceSource, validFrom) VALUES
  ('40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 1, '20000000-0000-0000-0000-0000000000a1', 'FALL', 'Guardrail', 'u', 100.00, 'catalog-source-1', '2026-01-01'),
  ('40000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 1, '20000000-0000-0000-0000-0000000000b2', 'FALL', 'Guardrail B', 'u', 100.00, 'catalog-source-b', '2026-01-01');
INSERT INTO prevention_budget_scenarios (id, organizationId, scenarioKey, version, sourceVersion, periodStart, periodEnd, contingencyRatePercent) VALUES
  ('50000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'scenario-a', 1, 'reports:v1', '2026-01-01', '2026-01-31', 10.00);
INSERT INTO prevention_budget_items (id, organizationId, scenarioId, itemKey, categoryId, categoryKey, title, quantity, unit, status) VALUES
  ('60000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1', 'item-a', '20000000-0000-0000-0000-0000000000a1', 'FALL', 'To price', 1.0000, 'u', 'A_CHIFFRER');
INSERT INTO prevention_budget_item_sources (id, organizationId, itemId, sourceKind, sourceKey, findingId, reportId) VALUES
  ('70000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', 'FINDING', REPEAT('a',64), '30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1');
INSERT INTO prevention_budget_audit (id, organizationId, scenarioId, scenarioVersion, action, afterState) VALUES
  ('80000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1', 1, 'BUILD', JSON_OBJECT('lineCount', 1));
SQL
echo 'ok - A_CHIFFRER item without price is accepted'

expect_failure 'catalogue cannot reference another tenant category' \
  "INSERT INTO prevention_cost_catalog (id, organizationId, version, categoryId, categoryKey, label, unit, unitCostHt, priceSource, validFrom) VALUES ('40000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1', 2, '20000000-0000-0000-0000-0000000000b2', 'FALL', 'Cross tenant', 'u', 1, 'source', '2026-01-01');"
expect_failure 'catalogue requires a non-empty price source' \
  "INSERT INTO prevention_cost_catalog (id, organizationId, version, categoryId, categoryKey, label, unit, unitCostHt, priceSource, validFrom) VALUES ('40000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 2, '20000000-0000-0000-0000-0000000000a1', 'FALL', 'No source', 'u', 1, '   ', '2026-01-01');"
expect_failure 'catalogue rejects negative price' \
  "INSERT INTO prevention_cost_catalog (id, organizationId, version, categoryId, categoryKey, label, unit, unitCostHt, priceSource, validFrom) VALUES ('40000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', 2, '20000000-0000-0000-0000-0000000000a1', 'FALL', 'Negative', 'u', -1, 'source', '2026-01-01');"
expect_failure 'catalogue versions must be monotonic' \
  "INSERT INTO prevention_cost_catalog (id, organizationId, version, categoryId, categoryKey, label, unit, unitCostHt, priceSource, validFrom) VALUES ('40000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 3, '20000000-0000-0000-0000-0000000000a1', 'FALL', 'Gap', 'u', 1, 'source', '2026-01-01');"
expect_failure 'catalogue versions are immutable' \
  "UPDATE prevention_cost_catalog SET label='changed' WHERE id='40000000-0000-0000-0000-0000000000a1';"
printf '%s\n' "INSERT INTO prevention_cost_catalog_audit (id,organizationId,catalogId,catalogVersion,actorId,action,beforeState,afterState) VALUES ('41000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','40000000-0000-0000-0000-0000000000a1',1,'42000000-0000-0000-0000-0000000000a1','STATUS_CHANGED',JSON_OBJECT('isActive',true),JSON_OBJECT('isActive',false));" | mysql_exec
expect_failure 'catalogue status audit is append-only' \
  "UPDATE prevention_cost_catalog_audit SET afterState=JSON_OBJECT('isActive',true) WHERE id='41000000-0000-0000-0000-0000000000a1';"
expect_failure 'scenario rejects inverted period' \
  "INSERT INTO prevention_budget_scenarios (id, organizationId, scenarioKey, version, sourceVersion, periodStart, periodEnd, contingencyRatePercent) VALUES ('50000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'scenario-b', 1, 'reports:v1', '2026-02-01', '2026-01-01', 10);"
expect_failure 'scenario rejects rate above 100 percent' \
  "INSERT INTO prevention_budget_scenarios (id, organizationId, scenarioKey, version, sourceVersion, periodStart, periodEnd, contingencyRatePercent) VALUES ('50000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', 'scenario-c', 1, 'reports:v1', '2026-01-01', '2026-01-31', 100.01);"
expect_failure 'scenario versions must be monotonic' \
  "INSERT INTO prevention_budget_scenarios (id, organizationId, scenarioKey, version, sourceVersion, periodStart, periodEnd, contingencyRatePercent) VALUES ('50000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 'scenario-a', 3, 'reports:v2', '2026-01-01', '2026-01-31', 10);"
expect_failure 'scenario versions are immutable' \
  "UPDATE prevention_budget_scenarios SET totalBudgetHt=1 WHERE id='50000000-0000-0000-0000-0000000000a1';"
expect_failure 'scenario cannot reference another tenant mission' \
  "INSERT INTO prevention_budget_scenarios (id, organizationId, scenarioKey, version, sourceVersion, periodStart, periodEnd, missionId, contingencyRatePercent) VALUES ('50000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a1', 'scenario-cross-mission', 1, 'reports:v1', '2026-01-01', '2026-01-31', '11000000-0000-0000-0000-0000000000b2', 10);"
expect_failure 'scenario cannot reference another tenant category' \
  "INSERT INTO prevention_budget_scenarios (id, organizationId, scenarioKey, version, sourceVersion, periodStart, periodEnd, categoryId, contingencyRatePercent) VALUES ('50000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a1', 'scenario-cross-category', 1, 'reports:v1', '2026-01-01', '2026-01-31', '20000000-0000-0000-0000-0000000000b2', 10);"
expect_failure 'priced item requires a price source' \
  "INSERT INTO prevention_budget_items (id, organizationId, scenarioId, itemKey, categoryKey, title, quantity, unit, unitCostHt, status) VALUES ('60000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1', 'item-b', 'FALL', 'Missing source', 1, 'u', 10, 'ESTIME');"
expect_failure 'validated item requires lockedManual' \
  "INSERT INTO prevention_budget_items (id, organizationId, scenarioId, itemKey, categoryKey, title, quantity, unit, unitCostHt, priceSource, status, lockedManual) VALUES ('60000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1', 'item-c', 'FALL', 'Unlocked', 1, 'u', 10, 'manual', 'VALIDE', 0);"
expect_failure 'item cannot reference another tenant catalogue' \
  "INSERT INTO prevention_budget_items (id, organizationId, scenarioId, itemKey, catalogId, categoryKey, title, quantity, unit, status) VALUES ('60000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1', 'item-d', '40000000-0000-0000-0000-0000000000b1', 'FALL', 'Cross catalog', 1, 'u', 'A_CHIFFRER');"
expect_failure 'item cannot reference another tenant category' \
  "INSERT INTO prevention_budget_items (id, organizationId, scenarioId, itemKey, categoryId, categoryKey, title, quantity, unit, status) VALUES ('60000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1', 'item-e', '20000000-0000-0000-0000-0000000000b2', 'FALL', 'Cross category', 1, 'u', 'A_CHIFFRER');"
expect_failure 'source cannot reference another tenant finding' \
  "INSERT INTO prevention_budget_item_sources (id, organizationId, itemId, sourceKind, sourceKey, findingId) VALUES ('70000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', 'FINDING', REPEAT('b',64), '30000000-0000-0000-0000-0000000000b2');"
expect_failure 'source cannot reference another tenant report' \
  "INSERT INTO prevention_budget_item_sources (id, organizationId, itemId, sourceKind, sourceKey, reportId) VALUES ('70000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', 'REPORT', REPEAT('c',64), '10000000-0000-0000-0000-0000000000b2');"
expect_failure 'finding source requires a report' \
  "INSERT INTO prevention_budget_item_sources (id, organizationId, itemId, sourceKind, sourceKey, findingId) VALUES ('70000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', 'FINDING', REPEAT('d',64), '30000000-0000-0000-0000-0000000000a1');"
expect_failure 'audit is append-only' \
  "UPDATE prevention_budget_audit SET action='RECONCILE' WHERE organizationId='00000000-0000-0000-0000-0000000000a1';"

mysql_exec <<'SQL'
INSERT INTO prevention_budget_reconciliation_intents
  (id,eventId,organizationId,reportId,scenarioId,scenarioVersion,sourceVersion,status,availableAt)
VALUES
  ('90000000-0000-0000-0000-0000000000a1','91000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1',
   '50000000-0000-0000-0000-0000000000a1',1,
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','PENDING',UTC_TIMESTAMP(6));
DELETE FROM reports WHERE organizationId='00000000-0000-0000-0000-0000000000a1'
  AND id='10000000-0000-0000-0000-0000000000a1';
SQL
expect_scalar 'reconciliation intent survives report deletion' '1' \
  "SELECT COUNT(*) FROM prevention_budget_reconciliation_intents WHERE organizationId='00000000-0000-0000-0000-0000000000a1' AND reportId='10000000-0000-0000-0000-0000000000a1' AND status='PENDING';"
expect_scalar 'historical budget source survives report deletion' '1' \
  "SELECT COUNT(*) FROM prevention_budget_item_sources WHERE organizationId='00000000-0000-0000-0000-0000000000a1' AND reportId='10000000-0000-0000-0000-0000000000a1' AND sourceKey=REPEAT('a',64);"

mysql_exec <<'SQL'
INSERT INTO prevention_budget_scenarios (id, organizationId, scenarioKey, version, sourceVersion, periodStart, periodEnd, contingencyRatePercent) VALUES
  ('50000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'scenario-b', 1, 'reports:v1', '2026-01-01', '2026-01-31', 0);
DELETE FROM organizations WHERE id='00000000-0000-0000-0000-0000000000a1';
SQL
expect_scalar 'organization deletion cascades all tenant Budget rows' '0' \
  "SELECT (SELECT COUNT(*) FROM prevention_cost_catalog WHERE organizationId='00000000-0000-0000-0000-0000000000a1') + (SELECT COUNT(*) FROM prevention_cost_catalog_audit WHERE organizationId='00000000-0000-0000-0000-0000000000a1') + (SELECT COUNT(*) FROM prevention_budget_scenarios WHERE organizationId='00000000-0000-0000-0000-0000000000a1') + (SELECT COUNT(*) FROM prevention_budget_reconciliation_intents WHERE organizationId='00000000-0000-0000-0000-0000000000a1') + (SELECT COUNT(*) FROM prevention_budget_items WHERE organizationId='00000000-0000-0000-0000-0000000000a1') + (SELECT COUNT(*) FROM prevention_budget_item_sources WHERE organizationId='00000000-0000-0000-0000-0000000000a1') + (SELECT COUNT(*) FROM prevention_budget_audit WHERE organizationId='00000000-0000-0000-0000-0000000000a1');"

echo 'VALIDATION PASSED: P8B Budget migration, tenant isolation, integrity checks and rollback verified.'
