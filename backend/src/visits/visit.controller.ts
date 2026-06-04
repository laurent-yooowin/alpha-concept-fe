import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { VisitService } from './visit.service';
import { CreateVisitDto, UpdateVisitDto } from './visit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import { User } from '../user/user.entity';

@Controller('visits')
@UseGuards(JwtAuthGuard)
export class VisitController {
  constructor(private readonly visitService: VisitService) {}

  @Post()
  @RequirePermission('visits', 'write')
  async create(
    @CurrentUser() user: User,
    @Body() createVisitDto: CreateVisitDto,
  ) {
    return this.visitService.create(user, createVisitDto);
  }

  @Get()
  @RequirePermission('visits', 'read')
  async findAll(
    @CurrentUser() user: User,
    @Query('missionId') missionId?: string,
  ) {
    if (missionId) {
      return this.visitService.findByMission(missionId, user);
    }
    return this.visitService.findAll(user, missionId);
  }

  @Get(':id')
  @RequirePermission('visits', 'read')
  async findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.visitService.findOne(id, user);
  }

  @Put(':id')
  @RequirePermission('visits', 'write')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateVisitDto: UpdateVisitDto,
  ) {
    return this.visitService.update(id, user, updateVisitDto);
  }

  @Delete(':id')
  @RequirePermission('visits', 'write')
  async delete(@CurrentUser() user: User, @Param('id') id: string) {
    await this.visitService.delete(id, user);
    return { message: 'Visit deleted successfully' };
  }

  @Post(':id/generate-report')
  @RequirePermission('reports', 'write')
  async generateReport(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { header?: string; footer?: string; notes?: string },
  ) {
    return this.visitService.generateReportFromVisit(id, user, body);
  }
}
