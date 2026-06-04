/**
 * Attach legacy data to the organization created from Hyper Admin.
 *
 * Usage:
 *   yarn backfill:alpha-concept-org
 *
 * Optional env:
 *   TARGET_ORG_SLUG=alphaconcept        # otherwise tries alpha_concept, alphaconcept, alpha-concept
 *   SOURCE_ORG_SLUGS=default            # comma-separated legacy org slugs
 *   OVERWRITE_ALL_ORGS=true             # move all rows except target org rows
 *   DRY_RUN=true                        # print counts without updating
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource, EntityManager } from 'typeorm';
import dataSource from '../config/typeorm.config';

config();

type CountRow = { count: string | number };
type OrgRow = { id: string; slug: string };
type UpdateResult = { affectedRows?: number; changedRows?: number };
type QueryExecutor = DataSource | EntityManager;

const targetOrgSlug = process.env.TARGET_ORG_SLUG;
const targetOrgSlugCandidates = targetOrgSlug
  ? [targetOrgSlug]
  : ['alpha_concept', 'alphaconcept', 'alpha-concept'];
const sourceOrgSlugs = (process.env.SOURCE_ORG_SLUGS || 'default')
  .split(',')
  .map((slug) => slug.trim())
  .filter(Boolean);
const overwriteAllOrgs = process.env.OVERWRITE_ALL_ORGS === 'true';
const dryRun = process.env.DRY_RUN === 'true';

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

function readAffected(result: UpdateResult): number {
  return result.affectedRows ?? result.changedRows ?? 0;
}

function sourceWhere(
  columnName: string,
  targetOrgId: string,
  sourceOrgIds: string[],
  includeNull = true,
): { sql: string; params: string[] } {
  if (overwriteAllOrgs) {
    return includeNull
      ? { sql: `(${columnName} IS NULL OR ${columnName} <> ?)`, params: [targetOrgId] }
      : { sql: `${columnName} <> ?`, params: [targetOrgId] };
  }

  const parts: string[] = [];
  const params: string[] = [];

  if (includeNull) {
    parts.push(`${columnName} IS NULL`);
  }

  if (sourceOrgIds.length > 0) {
    parts.push(`${columnName} IN (${placeholders(sourceOrgIds)})`);
    params.push(...sourceOrgIds);
  }

  return {
    sql: parts.length > 0 ? `(${parts.join(' OR ')})` : '1 = 0',
    params,
  };
}

async function countRows(tableName: string, whereSql: string, params: string[]) {
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
  whereSql: string,
  params: string[],
) {
  const result = (await executor.query(
    `UPDATE \`${tableName}\` SET ${columnName} = ? WHERE ${whereSql}`,
    [targetOrgId, ...params],
  )) as UpdateResult;

  return readAffected(result);
}

async function mergeMailingListEntries(
  executor: QueryExecutor,
  targetOrgId: string,
  whereSql: string,
  duplicateWhereSql: string,
  params: string[],
) {
  const deleteResult = (await executor.query(
    `
      DELETE legacy
      FROM \`mailing_list_entries\` legacy
      INNER JOIN \`mailing_list_entries\` target
        ON target.\`organizationId\` = ?
        AND target.\`email\` = legacy.\`email\`
      WHERE ${duplicateWhereSql}
        AND legacy.\`organizationId\` <> ?
    `,
    [targetOrgId, ...params, targetOrgId],
  )) as UpdateResult;

  const updateResult = (await executor.query(
    `UPDATE \`mailing_list_entries\` SET \`organizationId\` = ? WHERE ${whereSql}`,
    [targetOrgId, ...params],
  )) as UpdateResult;

  return {
    deletedDuplicates: readAffected(deleteResult),
    updated: readAffected(updateResult),
  };
}

async function mergeUserOrganizations(
  executor: QueryExecutor,
  targetOrgId: string,
  sourceOrgIds: string[],
) {
  if (sourceOrgIds.length === 0 || overwriteAllOrgs) {
    return { inserted: 0, deletedLegacy: 0 };
  }

  const insertResult = (await executor.query(
    `
      INSERT IGNORE INTO \`user_organizations\` (\`userId\`, \`organizationId\`, \`role\`, \`createdAt\`)
      SELECT \`userId\`, ?, \`role\`, \`createdAt\`
      FROM \`user_organizations\`
      WHERE \`organizationId\` IN (${placeholders(sourceOrgIds)})
    `,
    [targetOrgId, ...sourceOrgIds],
  )) as UpdateResult;

  const deleteResult = (await executor.query(
    `
      DELETE FROM \`user_organizations\`
      WHERE \`organizationId\` IN (${placeholders(sourceOrgIds)})
    `,
    sourceOrgIds,
  )) as UpdateResult;

  return {
    inserted: readAffected(insertResult),
    deletedLegacy: readAffected(deleteResult),
  };
}

async function main() {
  await dataSource.initialize();

  try {
    const targetRows = (await dataSource.query(
      `
        SELECT id, slug
        FROM \`organizations\`
        WHERE slug IN (${placeholders(targetOrgSlugCandidates)})
        ORDER BY FIELD(slug, ${placeholders(targetOrgSlugCandidates)})
        LIMIT 1
      `,
      [...targetOrgSlugCandidates, ...targetOrgSlugCandidates],
    )) as OrgRow[];
    const targetOrg = targetRows[0];

    if (!targetOrg) {
      const availableOrgs = (await dataSource.query(
        'SELECT slug FROM `organizations` ORDER BY slug LIMIT 20',
      )) as Array<{ slug: string }>;
      const availableSlugs = availableOrgs.map((org) => org.slug).join(', ') || 'none';

      throw new Error(
        `Organization slug not found. Tried: ${targetOrgSlugCandidates.join(', ')}. Available slugs: ${availableSlugs}. Create it from Hyper Admin first, or set TARGET_ORG_SLUG to the real slug.`,
      );
    }

    const sourceRows =
      sourceOrgSlugs.length > 0
        ? ((await dataSource.query(
            `SELECT id, slug FROM \`organizations\` WHERE slug IN (${placeholders(sourceOrgSlugs)})`,
            sourceOrgSlugs,
          )) as OrgRow[])
        : [];
    const sourceOrgIds = sourceRows
      .map((org) => org.id)
      .filter((id) => id !== targetOrg.id);

    console.log(`Target organization: ${targetOrg.slug} (${targetOrg.id})`);
    console.log(
      overwriteAllOrgs
        ? 'Source scope: all organizations except target, plus NULL rows'
        : `Source scope: NULL rows and slugs [${sourceRows.map((org) => org.slug).join(', ') || 'none'}]`,
    );
    if (dryRun) {
      console.log('DRY_RUN=true: no data will be updated.');
    }

    const scopedTables = [
      { table: 'users', column: '`organizationId`', label: 'users', extra: "`role` IN ('ROLE_USER', 'ROLE_ADMIN')" },
      { table: 'missions', column: '`organizationId`', label: 'missions' },
      { table: 'visits', column: '`organizationId`', label: 'visits' },
      { table: 'reports', column: '`organizationId`', label: 'reports' },
      { table: 'mission_assignments', column: '`organizationId`', label: 'mission_assignments' },
      { table: 'clients', column: '`organizationId`', label: 'clients' },
      { table: 'activity_logs', column: '`organization_id`', label: 'activity_logs' },
    ];

    const planned: Array<{ label: string; count: number }> = [];

    for (const item of scopedTables) {
      const where = sourceWhere(item.column, targetOrg.id, sourceOrgIds);
      const whereSql = item.extra ? `${where.sql} AND ${item.extra}` : where.sql;
      planned.push({
        label: item.label,
        count: await countRows(item.table, whereSql, where.params),
      });
    }

    const mailingWhere = sourceWhere('`organizationId`', targetOrg.id, sourceOrgIds, false);
    const mailingDuplicateWhere = sourceWhere('legacy.`organizationId`', targetOrg.id, sourceOrgIds, false);
    planned.push({
      label: 'mailing_list_entries',
      count: await countRows('mailing_list_entries', mailingWhere.sql, mailingWhere.params),
    });

    console.table(planned);

    if (dryRun) {
      return;
    }

    await dataSource.transaction(async (manager) => {
      for (const item of scopedTables) {
        const where = sourceWhere(item.column, targetOrg.id, sourceOrgIds);
        const whereSql = item.extra ? `${where.sql} AND ${item.extra}` : where.sql;
        const affected = await updateRows(
          manager,
          item.table,
          item.column,
          targetOrg.id,
          whereSql,
          where.params,
        );
        console.log(`${item.label}: ${affected} row(s) attached.`);
      }

      const mailing = await mergeMailingListEntries(
        manager,
        targetOrg.id,
        mailingWhere.sql,
        mailingDuplicateWhere.sql,
        mailingWhere.params,
      );
      console.log(
        `mailing_list_entries: ${mailing.updated} row(s) attached, ${mailing.deletedDuplicates} duplicate(s) removed.`,
      );

      const userOrganizations = await mergeUserOrganizations(manager, targetOrg.id, sourceOrgIds);
      console.log(
        `user_organizations: ${userOrganizations.inserted} row(s) inserted, ${userOrganizations.deletedLegacy} legacy row(s) removed.`,
      );
    });

    console.log('Legacy organization backfill completed.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
