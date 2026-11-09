import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mission } from '../missions/mission.entity';
import { Report, ReportStatus } from '../reports/report.entity';
import { User, UserRole } from '../user/user.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Mission)
    private missionRepository: Repository<Mission>,
    @InjectRepository(Report)
    private reportRepository: Repository<Report>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  private applyScope<T>(qb: any, alias: string, user: User) {
    if (user.role === UserRole.HYPER_ADMIN) return qb;
    qb.andWhere(`${alias}.organizationId = :oid`, { oid: user.organizationId });
    if (user.role === UserRole.USER) {
      qb.andWhere(`${alias}.userId = :uid`, { uid: user.id });
    }
    return qb;
  }

  async getStats(user: User) {
    const missionQuery = this.applyScope(
      this.missionRepository.createQueryBuilder('mission').where('1=1'),
      'mission',
      user,
    );
    const reportQuery = this.applyScope(
      this.reportRepository.createQueryBuilder('report').where('1=1'),
      'report',
      user,
    );

    const totalMissions = await missionQuery.getCount();
    const pendingMissions = await missionQuery
      .clone()
      .andWhere("mission.status IN ('planifiee', 'en_cours', 'assignee')")
      .getCount();
    const completedMissions = await missionQuery
      .clone()
      .andWhere("mission.status = 'terminee'")
      .getCount();

    const totalReports = await reportQuery.getCount();
    const submittedReports = await reportQuery
      .clone()
      .andWhere('report.status NOT IN (:...excluded)', { excluded: [ReportStatus.DRAFT, ReportStatus.CANCELLED] })
      .getCount();
    const draftReports = await reportQuery
      .clone()
      .andWhere('report.status = :draft', { draft: ReportStatus.DRAFT })
      .getCount();
    const cancelledReports = await reportQuery
      .clone()
      .andWhere('report.status = :cancelled', { cancelled: ReportStatus.CANCELLED })
      .getCount();
    const validatedReports = await reportQuery
      .clone()
      .andWhere('report.status = :validated', { validated: ReportStatus.VALIDATED })
      .getCount();
    const sentReports = await reportQuery
      .clone()
      .andWhere('report.status = :sent', { sent: ReportStatus.SENT_TO_CLIENT })
      .getCount();

    const coordinatorsQb = this.userRepository
      .createQueryBuilder('user')
      .where('user.role = :role', { role: UserRole.USER });
    if (user.role !== UserRole.HYPER_ADMIN) {
      coordinatorsQb.andWhere('user.organizationId = :oid', { oid: user.organizationId });
    }
    const totalCoordinators = await coordinatorsQb.getCount();

    const avgQb = this.applyScope(
      this.reportRepository
        .createQueryBuilder('report')
        .select('AVG(DATEDIFF(report.updatedAt, report.createdAt))', 'avgDays')
        .where('report.status = :validated', { validated: ReportStatus.VALIDATED }),
      'report',
      user,
    );
    const avgRow = await avgQb.getRawOne();
    const avgProcessingTime = avgRow?.avgDays == null ? null : Number(avgRow.avgDays);

    return {
      totalMissions,
      pendingMissions,
      completedMissions,
      totalReports,
      submittedReports,
      draftReports,
      cancelledReports,
      validatedReports,
      sentReports,
      totalCoordinators,
      avgProcessingTime: avgProcessingTime == null || !Number.isFinite(avgProcessingTime)
        ? null : Math.round(avgProcessingTime * 10) / 10,
    };
  }

  async getMonthlyMissions(user: User) {
    const qb = this.applyScope(
      this.missionRepository
        .createQueryBuilder('mission')
        .select("DATE_FORMAT(mission.date, '%b %Y')", 'month')
        .addSelect('COUNT(*)', 'count')
        .where("mission.date >= DATE_FORMAT(DATE_SUB(UTC_DATE(), INTERVAL 5 MONTH), '%Y-%m-01')")
        .andWhere("mission.date < DATE_FORMAT(DATE_ADD(UTC_DATE(), INTERVAL 1 MONTH), '%Y-%m-01')"),
      'mission',
      user,
    )
      .groupBy("DATE_FORMAT(mission.date, '%b %Y'), YEAR(mission.date), MONTH(mission.date)")
      .orderBy('YEAR(mission.date)', 'ASC')
      .addOrderBy('MONTH(mission.date)', 'ASC');

    const results = await qb.getRawMany();
    return results.map((r) => ({ month: r.month, count: parseInt(r.count) }));
  }

  async getCoordinatorStats(user: User) {
    const qb = this.applyScope(
      this.missionRepository
        .createQueryBuilder('mission')
        .leftJoin('mission.user', 'user')
        .select("CONCAT(user.firstName, ' ', user.lastName)", 'name')
        .addSelect('COUNT(*)', 'count')
        .where('1=1'),
      'mission',
      user,
    )
      .groupBy('user.id, user.firstName, user.lastName')
      .orderBy('COUNT(*)', 'DESC')
      .limit(5);

    const results = await qb.getRawMany();
    return results.map((r) => ({ name: r.name, count: parseInt(r.count) }));
  }

  async getStatusBreakdown(user: User) {
    const qb = this.applyScope(
      this.missionRepository
        .createQueryBuilder('mission')
        .select('mission.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('1=1'),
      'mission',
      user,
    ).groupBy('mission.status');

    const results = await qb.getRawMany();
    return results.map((r) => ({ status: r.status, count: parseInt(r.count) }));
  }
}
