import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportStatus } from './report.entity';
import { CreateReportDto, UpdateReportDto } from './report.dto';
import { User, UserRole } from '../user/user.entity';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(Report)
    private reportRepository: Repository<Report>,
  ) {}

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

    if (updateReportDto.status === ReportStatus.SENT && !report.sentAt) {
      updateReportDto['sentAt'] = new Date();
    }

    Object.assign(report, updateReportDto);
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
