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

  async getStats(userId?: string, userRole?: UserRole) {
    const missionQuery = this.missionRepository.createQueryBuilder('mission');
    const reportQuery = this.reportRepository.createQueryBuilder('report');

    if (userRole === UserRole.USER && userId) {
      missionQuery.where('mission.userId = :userId', { userId });
      reportQuery.where('report.userId = :userId', { userId });
    }

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
      .andWhere("report.status != :draft", { draft: ReportStatus.DRAFT })
      .getCount();

    const validatedReports = await reportQuery
      .clone()
      .andWhere("report.status = :validated", { validated: ReportStatus.VALIDATED })
      .getCount();

    const sentReports = await reportQuery
      .clone()
      .andWhere("report.status = :sent", { sent: ReportStatus.SENT })
      .getCount();

    const coordinatorsQuery = this.userRepository
      .createQueryBuilder('user')
      .where("user.role = :role", { role: UserRole.USER });

    const totalCoordinators = await coordinatorsQuery.getCount();

    const avgProcessingTimeResult = await this.reportRepository
      .createQueryBuilder('report')
      .select('AVG(DATEDIFF(report.updatedAt, report.createdAt))', 'avgDays')
      .where("report.status = :validated", { validated: ReportStatus.VALIDATED })
      .getRawOne();

    const avgProcessingTime = avgProcessingTimeResult?.avgDays
      ? parseFloat(avgProcessingTimeResult.avgDays)
      : 0;

    return {
      totalMissions,
      pendingMissions,
      completedMissions,
      totalReports,
      submittedReports,
      validatedReports,
      sentReports,
      totalCoordinators,
      avgProcessingTime: Math.round(avgProcessingTime * 10) / 10,
    };
  }

  async getMonthlyMissions(userId?: string, userRole?: UserRole) {
    const query = this.missionRepository
      .createQueryBuilder('mission')
      .select("DATE_FORMAT(mission.date, '%b %Y')", 'month')
      .addSelect('COUNT(*)', 'count')
      .where("mission.date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)")
      .groupBy("DATE_FORMAT(mission.date, '%b %Y'), YEAR(mission.date), MONTH(mission.date)")
      .orderBy("YEAR(mission.date)", 'ASC')
      .addOrderBy("MONTH(mission.date)", 'ASC');

    if (userRole === UserRole.USER && userId) {
      query.andWhere('mission.userId = :userId', { userId });
    }

    const results = await query.getRawMany();

    return results.map((row) => ({
      month: row.month,
      count: parseInt(row.count),
    }));
  }

  async getCoordinatorStats(userId?: string, userRole?: UserRole) {
    const query = this.missionRepository
      .createQueryBuilder('mission')
      .leftJoin('mission.user', 'user')
      .select("CONCAT(user.firstName, ' ', user.lastName)", 'name')
      .addSelect('COUNT(*)', 'count')
      .groupBy('user.id, user.firstName, user.lastName')
      .orderBy('COUNT(*)', 'DESC')
      .limit(5);

    if (userRole === UserRole.USER && userId) {
      query.where('mission.userId = :userId', { userId });
    }

    const results = await query.getRawMany();

    return results.map((row) => ({
      name: row.name,
      count: parseInt(row.count),
    }));
  }

  async getStatusBreakdown(userId?: string, userRole?: UserRole) {
    const query = this.missionRepository
      .createQueryBuilder('mission')
      .select('mission.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('mission.status');

    if (userRole === UserRole.USER && userId) {
      query.where('mission.userId = :userId', { userId });
    }

    const results = await query.getRawMany();

    return results.map((row) => ({
      status: row.status,
      count: parseInt(row.count),
    }));
  }
}
