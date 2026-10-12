import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query, Patch } from '@nestjs/common';
import { VisitService } from './visit.service';
import {
  AnalysisGroupAttachDto,
  AnalysisGroupBulkEditDto,
  AnalysisGroupClarifyDto,
  AnalysisGroupCreateDto,
  AnalysisGroupPatchDto,
  AnalysisGroupReanalyzeAllDto,
  AnalysisGroupReanalyzeDto,
  CreateVisitDto,
  UpdateVisitDto,
} from './visit.dto';
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

  @Post(':visitId/analysis-groups')
  @RequirePermission('visits', 'write')
  createAnalysisGroup(@CurrentUser() user: User, @Param('visitId') visitId: string, @Body() dto: AnalysisGroupCreateDto) {
    return this.visitService.createAnalysisGroup(user, visitId, dto);
  }

  @Post(':visitId/analysis-groups/reanalyze-all')
  @RequirePermission('visits', 'write')
  reanalyzeAll(@CurrentUser() user: User, @Param('visitId') visitId: string, @Body() dto: AnalysisGroupReanalyzeAllDto) {
    return this.visitService.reanalyzeAll(user, visitId, dto);
  }

  @Post(':visitId/analysis-groups/:groupId/reanalyze')
  @RequirePermission('visits', 'write')
  reanalyzeGroup(@CurrentUser() user: User, @Param('visitId') visitId: string, @Param('groupId') groupId: string, @Body() dto: AnalysisGroupReanalyzeDto) {
    return this.visitService.reanalyzeGroup(user, visitId, groupId, dto);
  }

  @Post(':visitId/analysis-groups/:groupId/clarify')
  @RequirePermission('visits', 'write')
  clarifyGroup(@CurrentUser() user: User, @Param('visitId') visitId: string, @Param('groupId') groupId: string, @Body() dto: AnalysisGroupClarifyDto) {
    return this.visitService.clarifyGroup(user, visitId, groupId, dto);
  }

  @Post(':visitId/analysis-groups/:groupId/photos')
  @RequirePermission('visits', 'write')
  attachPhotos(@CurrentUser() user: User, @Param('visitId') visitId: string, @Param('groupId') groupId: string, @Body() dto: AnalysisGroupAttachDto) {
    return this.visitService.attachPhotos(user, visitId, groupId, dto);
  }

  @Patch(':visitId/analysis-groups')
  @RequirePermission('visits', 'write')
  patchGroups(@CurrentUser() user: User, @Param('visitId') visitId: string, @Body() dto: AnalysisGroupBulkEditDto) {
    return this.visitService.patchGroups(user, visitId, dto);
  }

  @Patch(':visitId/analysis-groups/:groupId')
  @RequirePermission('visits', 'write')
  patchGroup(@CurrentUser() user: User, @Param('visitId') visitId: string, @Param('groupId') groupId: string, @Body() dto: AnalysisGroupPatchDto) {
    return this.visitService.patchGroup(user, visitId, groupId, dto);
  }

  @Delete(':visitId/analysis-groups/:groupId/photos/:photoId')
  @RequirePermission('visits', 'write')
  deleteGroupPhoto(@CurrentUser() user: User, @Param('visitId') visitId: string, @Param('groupId') groupId: string, @Param('photoId') photoId: string) {
    return this.visitService.deleteGroupPhoto(user, visitId, groupId, photoId);
  }

  @Delete(':visitId/analysis-groups/:groupId')
  @RequirePermission('visits', 'write')
  deleteGroup(@CurrentUser() user: User, @Param('visitId') visitId: string, @Param('groupId') groupId: string) {
    return this.visitService.deleteGroup(user, visitId, groupId);
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
