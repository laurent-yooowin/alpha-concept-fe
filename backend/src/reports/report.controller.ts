import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ReportService } from './report.service';
import { CreateReportDto, UpdateReportDto } from './report.dto';
import { ReportStatus } from './report.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../user/user.entity';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post()
  async create(
    @CurrentUser() user: User,
    @Body() createReportDto: CreateReportDto,
  ) {
    return this.reportService.create(user.id, createReportDto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: User,
    @Query('status') status?: ReportStatus,
  ) {
    return this.reportService.findAll(user, status);
  }

  @Get('counts')
  async getCounts(@CurrentUser() user: User) {
    return this.reportService.countByStatus(user);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.reportService.findOne(id, user);
  }

  @Put(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateReportDto: UpdateReportDto,
  ) {
    return this.reportService.update(id, user, updateReportDto);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: User, @Param('id') id: string) {
    await this.reportService.delete(id, user);
    return { message: 'Report deleted successfully' };
  }

  @Post(':id/send')
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
