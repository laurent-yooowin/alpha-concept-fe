import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { orgScope } from '../common/utils/org-scope';
import { Report, ReportStatus } from './report.entity';
import { CreateReportDto, UpdateReportDto } from './report.dto';
import { User, UserRole } from '../user/user.entity';
import { MissionService } from '../missions/mission.service';
import { UpdateMissionDto } from '../missions/mission.dto';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(Report)
    private reportRepository: Repository<Report>,

    @Inject(forwardRef(() => MissionService))
    private readonly missionService: MissionService,
  ) { }

  async create(userOrId: User | string, createReportDto: CreateReportDto): Promise<Report> {
    const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;
    const organizationId =
      typeof userOrId === 'string' ? null : userOrId.organizationId ?? null;

    const report = this.reportRepository.create({
      ...createReportDto,
      userId,
      organizationId,
    });

    return this.reportRepository.save(report);
  }

  async findAll(user: User, status?: ReportStatus): Promise<Report[]> {
    const where: any = orgScope(user);

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    if (status) {
      where.status = status;
    }

    let reportsDb: any = await this.reportRepository.find({
      where,
      relations: ['visit', 'mission'],
      order: { createdAt: 'DESC' }
    });

    if (reportsDb?.length > 0) {
      const reports = [];
      reportsDb.forEach((report) => {
        if (!reports.some(r => r.id == report.id) || reports.length == 0) {
          const secondeMission = reportsDb.filter(r => r.missionId == report.missionId);
          if (secondeMission?.length > 0) {
            secondeMission.forEach(sr => {
              const visit = sr.visit;
              sr.visit = { photos: visit.photos, photoCount: visit.photoCount, createdAt: visit.createdAt };
              reports.push(sr)
            });
          }
        }
      });
      return reports;
    }
    return [];
  }

  async findOne(id: string, user: User): Promise<Report> {
    const where: any = orgScope(user, { id });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    const report = await this.reportRepository.findOne({
      where,
      relations: ['mission', 'visit', 'user'],
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  async findByVisit(visitId: string, user: User): Promise<Report> {
    const where: any = orgScope(user, { visitId });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    const report = await this.reportRepository.findOne({ where });
    return report || null;
  }

  async findByMission(missionId: string, user: User): Promise<Report[]> {
    const where: any = orgScope(user, { missionId });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }
    return this.reportRepository.findBy(where);
  }

  async update(id: string, user: User, updateReportDto: UpdateReportDto): Promise<Report> {
    const report = await this.findOne(id, user);

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    // if ((updateReportDto.status === ReportStatus.VALIDATED || updateReportDto.status === ReportStatus.SENT_TO_CLIENT) && user.role == UserRole.ADMIN) {
    //   throw new NotFoundException('Only Coordonator can validate / send to clients the reports');
    // }

    if (updateReportDto.status === ReportStatus.SENT) {
      updateReportDto['sentAt'] = new Date();
    }

    if (updateReportDto.status === ReportStatus.SENT_TO_CLIENT) {
      updateReportDto['sentToClientAt'] = new Date();
      // const mission = await this.missionService.findOne(report.missionId, user);
      // mission.status = 'terminee';
      // const missionDto = new UpdateMissionDto();
      // Object.assign(missionDto, mission);
      // await this.missionService.update(mission.id, mission.userId, missionDto);      
    }

    if (updateReportDto.status === ReportStatus.VALIDATED) {
      updateReportDto['validatedAt'] = new Date();
      const mission = await this.missionService.findOne(report.missionId, user);
      mission.status = 'terminee';
      const missionDto = new UpdateMissionDto();
      Object.assign(missionDto, mission);
      await this.missionService.update(mission.id, user, missionDto);
    }

    // Strip relation objects to avoid TypeORM nulling join columns on save
    const { visit, mission, user: _u, ...rest } = report as any;
    Object.assign(rest, updateReportDto);
    // Ensure required FK columns are preserved
    rest.visitId = report.visitId;
    rest.missionId = report.missionId;
    rest.userId = report.userId;
    console.log('Updated report:', rest);
    await this.reportRepository.save(rest);
    return this.findOne(id, user);
  }

  async delete(id: string, user: User): Promise<void> {
    const report = await this.findOne(id, user);
    await this.reportRepository.remove(report);
  }

  async save(report: Report, user: User): Promise<void> {
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    await this.reportRepository.save(report);
  }

  async countByStatus(user: User): Promise<{ [key: string]: number }> {
    const where: any = orgScope(user);

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    const reports = await this.reportRepository.find({ where });

    return {
      [ReportStatus.DRAFT]: reports.filter(r => r.status === ReportStatus.DRAFT).length,
      [ReportStatus.SENT]: reports.filter(r => r.status === ReportStatus.SENT).length,
      [ReportStatus.VALIDATED]: reports.filter(r => r.status === ReportStatus.VALIDATED).length,
      [ReportStatus.REJECTED]: reports.filter(r => r.status === ReportStatus.REJECTED).length,
      [ReportStatus.ARCHIVED]: reports.filter(r => r.status === ReportStatus.ARCHIVED).length,
    };
  }

  async sendReportToClient(
    reportId: string,
    user: User,
    recipientEmail: string,
    subject: string,
    message: string
  ): Promise<{ success: boolean; message: string }> {
    const report = await this.findOne(reportId, user);

    return {
      success: true,
      message: `Report would be sent to ${recipientEmail} (Email service not yet configured)`,
    };
  }
}
