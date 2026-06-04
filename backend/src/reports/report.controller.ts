import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ReportService } from './report.service';
import { CreateReportDto, UpdateReportDto } from './report.dto';
import { ReportStatus } from './report.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import { User } from '../user/user.entity';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post()
  @RequirePermission('reports', 'write')
  async create(
    @CurrentUser() user: User,
    @Body() createReportDto: CreateReportDto,
  ) {
    return this.reportService.create(user, createReportDto);
  }

  @Get()
  @RequirePermission('reports', 'read')
  async findAll(
    @CurrentUser() user: User,
    @Query('status') status?: ReportStatus,
  ) {
    return this.reportService.findAll(user, status);
  }

  @Get('counts')
  @RequirePermission('reports', 'read')
  async getCounts(@CurrentUser() user: User) {
    return this.reportService.countByStatus(user);
  }

  @Get(':id')
  @RequirePermission('reports', 'read')
  async findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.reportService.findOne(id, user);
  }

  @Put(':id')
  @RequirePermission('reports', 'write')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateReportDto: UpdateReportDto,
  ) {
    return this.reportService.update(id, user, updateReportDto);
  }

  @Delete(':id')
  @RequirePermission('reports', 'write')
  async delete(@CurrentUser() user: User, @Param('id') id: string) {
    await this.reportService.delete(id, user);
    return { message: 'Report deleted successfully' };
  }

  @Post(':id/send')
  @RequirePermission('reports', 'write')
  async sendToClient(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { email: string; subject: string; message: string },
  ) {
    return this.reportService.sendReportToClient(
      id,
      user,
      body.email,
      body.subject,
      body.message,
    );
  }
}
