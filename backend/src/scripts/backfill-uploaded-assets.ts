import 'reflect-metadata';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import dataSource from '../config/typeorm.config';
import { LegacyAssetBackfillService } from '../upload/legacy-asset-backfill.service';
import { UploadedAssetService } from '../upload/uploaded-asset.service';

config();

/**
 * Non-destructive legacy asset inventory. Dry-run is the default.
 * Apply only with ASSET_BACKFILL_APPLY=true. This script never calls S3.
 */
async function main(): Promise<void> {
  const dryRun = process.env.ASSET_BACKFILL_APPLY !== 'true';
  const organizationId = String(process.env.ASSET_BACKFILL_ORGANIZATION_ID || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
    throw new Error('ASSET_BACKFILL_ORGANIZATION_ID must be an explicit UUID');
  }
  const configService = new ConfigService(process.env);
  // The inventory may contain sensitive object references. Disable TypeORM
  // query logging before opening the connection so parameters never appear.
  const quietDataSource = new DataSource({ ...dataSource.options, logging: false });
  await quietDataSource.initialize();
  try {
    const assets = new UploadedAssetService(quietDataSource, configService);
    const backfill = new LegacyAssetBackfillService(quietDataSource, assets);
    const summary = await backfill.run({
      organizationId,
      dryRun,
      limit: Number(process.env.ASSET_BACKFILL_LIMIT || 100),
      visitCursor: process.env.ASSET_BACKFILL_VISIT_CURSOR,
      reportCursor: process.env.ASSET_BACKFILL_REPORT_CURSOR,
      organizationCursor: process.env.ASSET_BACKFILL_ORGANIZATION_CURSOR,
    });
    // Deliberately bounded output: no raw keys or URLs are emitted.
    console.log(JSON.stringify({ dryRun, ...summary }));
  } finally {
    await quietDataSource.destroy();
  }
}

if (require.main === module) void main().catch((error) => { console.error(error); process.exitCode = 1; });
