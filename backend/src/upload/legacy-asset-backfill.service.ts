import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UploadedAssetService } from './uploaded-asset.service';
import { UploadedAssetType } from './uploaded-asset.entity';

export interface LegacyAssetBackfillOptions {
  organizationId: string;
  dryRun?: boolean;
  limit?: number;
  visitCursor?: string;
  reportCursor?: string;
  organizationCursor?: string;
}

export interface LegacyAssetBackfillSummary {
  visits: number;
  reports: number;
  organizations: number;
  inserted: number;
  updated: number;
  ambiguous: number;
  unresolved: number;
  skipped: number;
  hasMore: { visits: boolean; reports: boolean; organizations: boolean };
  next: { visitCursor?: string; reportCursor?: string; organizationCursor?: string };
}

@Injectable()
export class LegacyAssetBackfillService {
  constructor(private readonly db: DataSource, private readonly assets: UploadedAssetService) {}

  private parsePhotos(value: unknown): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }

  private keyFromReference(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try { return this.assets.keyFromUrl(value); } catch { return null; }
  }

  async run(options: LegacyAssetBackfillOptions): Promise<LegacyAssetBackfillSummary> {
    if (!options.organizationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.organizationId)) {
      throw new Error('organizationId must be an explicit UUID');
    }
    const dryRun = options.dryRun !== false;
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
    const summary: LegacyAssetBackfillSummary = {
      visits: 0, reports: 0, organizations: 0, inserted: 0, updated: 0, ambiguous: 0,
      unresolved: 0, skipped: 0, hasMore: { visits: false, reports: false, organizations: false }, next: {},
    };
    const seenKeys = new Set<string>();
    const record = async (row: any) => {
      try {
        const dedupeKey = `${row.organizationId}\u0000${row.s3Key}`;
        if (seenKeys.has(dedupeKey)) {
          summary.skipped += 1;
          return;
        }
        seenKeys.add(dedupeKey);
        const result = await this.assets.registerLegacy(row, dryRun);
        summary[result] += 1;
      } catch {
        summary.unresolved += 1;
      }
    };

    const visits = await this.db.query(
      `SELECT id,organizationId,photos FROM visits WHERE organizationId=? AND id>? ORDER BY id ASC LIMIT ?`,
      [options.organizationId, options.visitCursor || '', limit],
    );
    summary.hasMore.visits = visits.length === limit;
    for (const visit of visits) {
      summary.visits += 1;
      for (const [index, photo] of this.parsePhotos(visit.photos).entries()) {
        const reference = photo?.s3Url || photo?.uri;
        if (photo?.isDirectiveOnly === true || !reference) continue;
        const key = this.keyFromReference(reference);
        if (!key) { summary.unresolved += 1; continue; }
        await record({ organizationId: visit.organizationId, s3Key: key, objectType: UploadedAssetType.PHOTO, visitId: visit.id, sourceRef: `visits.photos[${index}]` });
      }
    }
    if (summary.hasMore.visits && visits.length) summary.next.visitCursor = visits[visits.length - 1].id;

    const reports = await this.db.query(
      `SELECT id,organizationId,reportFileUrl FROM reports WHERE organizationId=? AND id>? ORDER BY id ASC LIMIT ?`,
      [options.organizationId, options.reportCursor || '', limit],
    );
    summary.hasMore.reports = reports.length === limit;
    for (const report of reports) {
      summary.reports += 1;
      const key = this.keyFromReference(report.reportFileUrl);
      if (report.reportFileUrl && !key) summary.unresolved += 1;
      if (key) await record({ organizationId: report.organizationId, s3Key: key, objectType: UploadedAssetType.REPORT_PDF, reportId: report.id, sourceRef: 'reports.reportFileUrl' });
    }
    if (summary.hasMore.reports && reports.length) summary.next.reportCursor = reports[reports.length - 1].id;

    const organizations = await this.db.query(
      `SELECT id,logoS3Key,backgroundImageS3Key FROM organizations WHERE id=? LIMIT 1`,
      [options.organizationId],
    );
    // The run is explicitly scoped to one organization, so this source is
    // complete after its single row has been considered.
    summary.hasMore.organizations = false;
    for (const organization of organizations) {
      if (options.organizationCursor === organization.id) continue;
      summary.organizations += 1;
      const logo = this.keyFromReference(organization.logoS3Key);
      if (organization.logoS3Key && !logo) summary.unresolved += 1;
      if (logo) await record({ organizationId: organization.id, s3Key: logo, objectType: UploadedAssetType.ORGANIZATION_LOGO, sourceRef: 'organizations.logoS3Key' });
      const background = this.keyFromReference(organization.backgroundImageS3Key);
      if (organization.backgroundImageS3Key && !background) summary.unresolved += 1;
      if (background) await record({ organizationId: organization.id, s3Key: background, objectType: UploadedAssetType.ORGANIZATION_BACKGROUND, sourceRef: 'organizations.backgroundImageS3Key' });
    }
    return summary;
  }
}
