import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { User } from '../user/user.entity';

@Injectable()
export class LlmQuotaService {
  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  async reserve(user: User, operation: string, units = 1): Promise<void> {
    if (!user?.organizationId) throw new BadRequestException('Organisation requise');
    if (!Number.isInteger(units) || units < 1 || units > 20) {
      throw new BadRequestException('Nombre d’unités LLM invalide');
    }
    await this.db.transaction(async (manager) => {
      await manager.query(`SELECT id FROM organizations WHERE id=? LIMIT 1 FOR UPDATE`, [user.organizationId]);
      await manager.query(`SELECT id FROM users WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`, [user.organizationId, user.id]);
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const [usage] = await manager.query(
        `SELECT COALESCE(SUM(units),0) AS totalUser,
                (SELECT COALESCE(SUM(units),0) FROM llm_quota_events WHERE organizationId=? AND createdAt>=?) AS totalOrganization
         FROM llm_quota_events WHERE organizationId=? AND userId=? AND createdAt>=?`,
        [user.organizationId, since, user.organizationId, user.id, since],
      );
      const userLimit = Number(this.config.get('LLM_USER_QUOTA_PER_HOUR', process.env.LLM_USER_QUOTA_PER_HOUR || 20));
      const organizationLimit = Number(this.config.get('LLM_ORGANIZATION_QUOTA_PER_HOUR', process.env.LLM_ORGANIZATION_QUOTA_PER_HOUR || 200));
      if (!Number.isInteger(userLimit) || userLimit < 1 || userLimit > 10000 || !Number.isInteger(organizationLimit) || organizationLimit < 1 || organizationLimit > 100000) {
        throw new BadRequestException('Configuration de quota LLM invalide');
      }
      if (Number(usage?.totalUser || 0) + units > userLimit || Number(usage?.totalOrganization || 0) + units > organizationLimit) {
        throw new HttpException('Quota horaire d’analyses IA atteint', HttpStatus.TOO_MANY_REQUESTS);
      }
      await manager.query(
        `INSERT INTO llm_quota_events (id,organizationId,userId,operation,units,createdAt) VALUES (UUID(),?,?,?,?,UTC_TIMESTAMP(6))`,
        [user.organizationId, user.id, operation.slice(0, 64), units],
      );
    });
  }
}
