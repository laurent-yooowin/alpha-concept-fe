import 'reflect-metadata';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import dataSource from '../config/typeorm.config';
import { PreventionOrganizationActivationService } from '../prevention/prevention-organization-activation.service';

config();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const organizationId = process.env.PREVENTION_ACTIVATION_ORGANIZATION_ID?.trim();
  if (!organizationId || !UUID_PATTERN.test(organizationId)) {
    throw new Error('PREVENTION_ACTIVATION_ORGANIZATION_ID must be an explicit UUID');
  }
  const apply = process.env.PREVENTION_ACTIVATION_APPLY === 'true';
  if (process.env.PREVENTION_ACTIVATION_APPLY && !['true', 'false'].includes(process.env.PREVENTION_ACTIVATION_APPLY)) {
    throw new Error('PREVENTION_ACTIVATION_APPLY must be true or false');
  }
  if (apply && (!process.env.REDIS_HOST || !process.env.REDIS_PORT)) {
    throw new Error('Apply requires explicit REDIS_HOST and REDIS_PORT matching the Prevention worker');
  }
  const db = new DataSource({ ...dataSource.options, logging: false });
  let activation: PreventionOrganizationActivationService | null = null;
  try {
    await db.initialize();
    const [organization]: Array<{ id: string; isActive: number; preventionEnabled: number; reports: number }> = await db.query(
      `SELECT o.id,o.isActive,o.preventionEnabled,
        (SELECT COUNT(*) FROM reports r WHERE r.organizationId=o.id) AS reports
       FROM organizations o WHERE o.id=? LIMIT 1`, [organizationId],
    );
    if (!organization || Number(organization.isActive) !== 1) {
      throw new Error('Selected organization does not exist or is inactive');
    }
    console.log(JSON.stringify({ organizationId, active: true,
      preventionEnabled: Number(organization.preventionEnabled) === 1,
      reports: Number(organization.reports), dryRun: !apply }));
    if (apply && Number(organization.preventionEnabled) !== 1) {
      activation = new PreventionOrganizationActivationService(db, new ConfigService(process.env));
      await activation.activate(organizationId);
      console.log(JSON.stringify({ organizationId, activationStaged: true }));
    }
  } finally {
    if (activation) await activation.onApplicationShutdown();
    if (db.isInitialized) await db.destroy();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Prevention activation failed');
    process.exitCode = 1;
  });
}
