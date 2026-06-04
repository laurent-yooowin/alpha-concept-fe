/**
 * Move all existing tenant-scoped data to the organization identified by TARGET_ORG_SLUG.
 *
 * Usage:
 *   TARGET_ORG_SLUG=alphaconcept node dist/scripts/move-all-to-target-organization.js
 *
 * Optional env:
 *   DRY_RUN=true
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource, EntityManager } from 'typeorm';
import dataSource from '../config/typeorm.config';

config();

type CountRow = { count: string | number };
type OrgRow = { id: string; slug: string; name: string };
type UpdateResult = { affectedRows?: number; changedRows?: number };
type QueryExecutor = DataSource | EntityManager;

const targetOrgSlug = process.env.TARGET_ORG_SLUG?.trim();
const dryRun = process.env.DRY_RUN === 'true';

function readAffected(result: UpdateResult): number {
  return result.affectedRows ?? result.changedRows ?? 0;
}

async function countRows(tableName: string, whereSql: string, params: string[] = []) {
  const rows = (await dataSource.query(
    `SELECT COUNT(*) AS count FROM \`${tableName}\` WHERE ${whereSql}`,
    params,
  )) as CountRow[];

  return Number(rows[0]?.count ?? 0);
}

async function updateRows(
  executor: QueryExecutor,
  tableName: string,
  columnName: string,
  targetOrgId: string,
  whereSql = '1 = 1',
  params: string[] = [],
) {
  const result = (await executor.query(
    `UPDATE \`${tableName}\` SET ${columnName} = ? WHERE ${whereSql}`,
    [targetOrgId, ...params],
  )) as UpdateResult;

  return readAffected(result);
}

async function main() {
  if (!targetOrgSlug) {
    console.error('TARGET_ORG_SLUG is required.');
    process.exit(1);
  }

  await dataSource.initialize();

  try {
    const targetRows = (await dataSource.query(
      'SELECT id, slug, name FROM `organizations` WHERE slug = ? LIMIT 1',
      [targetOrgSlug],
    )) as OrgRow[];
    const targetOrg = targetRows[0];

    if (!targetOrg) {
      const availableOrgs = (await dataSource.query(
        'SELECT slug FROM `organizations` ORDER BY slug LIMIT 50',
      )) as Array<{ slug: string }>;
      const availableSlugs = availableOrgs.map((org) => org.slug).join(', ') || 'none';

      throw new Error(
        `Organization slug not found: ${targetOrgSlug}. Available slugs: ${availableSlugs}. Create the organization first.`,
      );
    }

    console.log(`Target organization: ${targetOrg.name} (${targetOrg.slug}, ${targetOrg.id})`);
    if (dryRun) {
      console.log('DRY_RUN=true: no data will be updated.');
    }

    const scopedTables = [
      { table: 'users', column: '`organizationId`', label: 'users', where: "`role` IN ('ROLE_USER','ROLE_ADMIN')" },
      { table: 'missions', column: '`organizationId`', label: 'missions' },
      { table: 'visits', column: '`organizationId`', label: 'visits' },
      { table: 'reports', column: '`organizationId`', label: 'reports' },
      { table: 'mission_assignments', column: '`organizationId`', label: 'mission_assignments' },
      { table: 'clients', column: '`organizationId`', label: 'clients' },
      { table: 'activity_logs', column: '`organization_id`', label: 'activity_logs' },
      { table: 'mailing_list_entries', column: '`organizationId`', label: 'mailing_list_entries' },
    ];

    const planned: Array<{ label: string; count: number }> = [];
    for (const item of scopedTables) {
      planned.push({
        label: item.label,
        count: await countRows(item.table, item.where || '1 = 1'),
      });
    }
    planned.push({
      label: 'hyper_admins_to_detach',
      count: await countRows('users', "`role` = 'ROLE_HYPER_ADMIN' AND `organizationId` IS NOT NULL"),
    });

    console.table(planned);

    if (dryRun) {
      return;
    }

    await dataSource.transaction(async (manager) => {
      const hyperAdminResult = (await manager.query(
        "UPDATE `users` SET `organizationId` = NULL WHERE `role` = 'ROLE_HYPER_ADMIN'",
      )) as UpdateResult;
      console.log(`${readAffected(hyperAdminResult)} hyper admin user(s) detached from organizations.`);

      for (const item of scopedTables) {
        const affected = await updateRows(
          manager,
          item.table,
          item.column,
          targetOrg.id,
          item.where || '1 = 1',
        );
        console.log(`${item.label}: ${affected} row(s) moved.`);
      }
    });

    console.log('Move to target organization completed.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
