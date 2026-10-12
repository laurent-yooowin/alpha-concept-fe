import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

type Queryable = { query(query: string, parameters?: any[]): Promise<any[]> };

@Injectable()
export class PreventionActivationService {
  constructor(private readonly dataSource: DataSource) {}

  async isEnabled(organizationId: string, queryable: Queryable = this.dataSource): Promise<boolean> {
    const [organization] = await queryable.query(
      'SELECT isActive,preventionEnabled FROM organizations WHERE id=? LIMIT 1',
      [organizationId],
    );
    return Boolean(organization && Number(organization.isActive) === 1 && Number(organization.preventionEnabled) === 1);
  }

  async assertEnabled(organizationId: string, queryable?: Queryable): Promise<void> {
    if (!(await this.isEnabled(organizationId, queryable))) {
      throw new ForbiddenException('Prévention inactive pour cette organisation');
    }
  }

  async enabledOrganizationIds(
    queryable: Queryable = this.dataSource,
    cursor: string | null = null,
    limit = 101,
  ): Promise<Array<{ id: string }>> {
    return queryable.query(
      `SELECT id FROM organizations
       WHERE isActive=1 AND preventionEnabled=1 AND (? IS NULL OR id>?)
       ORDER BY id LIMIT ?`,
      [cursor, cursor, limit],
    );
  }
}
