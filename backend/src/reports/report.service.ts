import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    private readonly missionService: MissionService,
  ) { }

  async create(userId: string, createReportDto: CreateReportDto): Promise<Report> {
    const report = this.reportRepository.create({
      ...createReportDto,
      userId,
    });

    return this.reportRepository.save(report);
  }

  async findAll(user: User, status?: ReportStatus): Promise<Report[]> {
    const where: any = {};

    if (user.role !== UserRole.ADMIN) {
      where.userId = user.id;
    }

    if (status) {
      where.status = status;
    }

    return this.reportRepository.find({
      where,
      relations: ['mission', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, user: User): Promise<Report> {
    const where: any = { id };

    if (user.role !== UserRole.ADMIN) {
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

  async update(id: string, user: User, updateReportDto: UpdateReportDto): Promise<Report> {
    const report = await this.findOne(id, user);

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if ((updateReportDto.status === ReportStatus.VALIDATED || updateReportDto.status === ReportStatus.SENT_TO_CLIENT) && user.role == UserRole.ADMIN) {
      throw new NotFoundException('Only Coordonator can validate / send to clients the reports');
    }

    if (updateReportDto.status === ReportStatus.SENT) {
      updateReportDto['sentAt'] = new Date();
    }

    if (updateReportDto.status === ReportStatus.SENT_TO_CLIENT) {
      updateReportDto['sentToClientAt'] = new Date();
      const mission = await this.missionService.findOne(report.missionId, user);
      mission.status = 'terminee';
      const missionDto = new UpdateMissionDto();
      Object.assign(missionDto, mission);
      await this.missionService.update(mission.id, mission.userId, missionDto);
    }

    if (updateReportDto.status === ReportStatus.VALIDATED ) {
      updateReportDto['validatedAt'] = new Date();
      const mission = await this.missionService.findOne(report.missionId, user);
      mission.status = 'terminee';
      const missionDto = new UpdateMissionDto();
      Object.assign(missionDto, mission);
      await this.missionService.update(mission.id, mission.userId, missionDto);
    }

    Object.assign(report, updateReportDto);
    console.log('Updated report:', report);
    return this.reportRepository.save(report);
  }

  async delete(id: string, user: User): Promise<void> {
    const report = await this.findOne(id, user);
    await this.reportRepository.remove(report);
  }

  async countByStatus(user: User): Promise<{ [key: string]: number }> {
    const where: any = {};

    if (user.role !== UserRole.ADMIN) {
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
