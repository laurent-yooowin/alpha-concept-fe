import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from './activity-log.entity';
import { User, UserRole } from '../user/user.entity';

@Injectable()
export class ActivityLogService {
  constructor(
    @InjectRepository(ActivityLog)
    private activityLogRepository: Repository<ActivityLog>,
  ) {}

  async create(logData: {
    userId: string;
    action: string;
    entityType: string;
    entityId?: string;
    details?: any;
    organizationId?: string | null;
  }): Promise<ActivityLog> {
    const log = this.activityLogRepository.create({
      userId: logData.userId,
      action: logData.action,
      entityType: logData.entityType,
      entityId: logData.entityId,
      details: logData.details,
      organizationId: logData.organizationId ?? null,
    });
    return this.activityLogRepository.save(log);
  }

  /**
   * List activity logs scoped to the current user's organization,
   * unless they are HYPER_ADMIN.
   */
  async findAll(currentUser: User, userId?: string): Promise<ActivityLog[]> {
    const query = this.activityLogRepository
      .createQueryBuilder('activity_log')
      .leftJoinAndSelect('activity_log.user', 'user')
      .orderBy('activity_log.created_at', 'DESC');

    if (currentUser.role !== UserRole.HYPER_ADMIN) {
      query.andWhere('activity_log.organization_id = :oid', {
        oid: currentUser.organizationId,
      });
    }

    if (userId) {
      query.andWhere('activity_log.user_id = :userId', { userId });
    }

    return query.getMany();
  }

  async findByUser(userId: string): Promise<ActivityLog[]> {
    return this.activityLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      relations: ['user'],
    });
  }
}
