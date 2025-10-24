import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { MissionService } from './mission.service';
import { CreateMissionDto, UpdateMissionDto } from './mission.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../user/user.entity';

@Controller('missions')
@UseGuards(JwtAuthGuard)
export class MissionController {
  constructor(private readonly missionService: MissionService) {}

  @Post()
  async create(
    @CurrentUser() user: User,
    @Body() createMissionDto: CreateMissionDto,
  ) {
    return this.missionService.create(user.id, createMissionDto);
  }

  @Get()
  async findAll(@CurrentUser() user: User) {
    return this.missionService.findAll(user);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.missionService.findOne(id, user);
  }

  @Post(':id/assign')
  async assignUsers(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { userIds: string[] },
  ) {
    return this.missionService.assignUsers(id, body.userIds, user.id);
  }

  @Get(':id/assigned-users')
  async getAssignedUsers(@Param('id') id: string) {
    return this.missionService.getAssignedUsers(id);
  }

  @Delete(':id/assign/:userId')
  async removeAssignment(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    await this.missionService.removeAssignment(id, userId);
    return { message: 'Assignment removed successfully' };
  }

  @Get('admin/all-users')
  async getAllUsers() {
    return this.missionService.getAllUsers();
  }

  @Put(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateMissionDto: UpdateMissionDto,
  ) {
    return this.missionService.update(id, user.id, updateMissionDto);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: User, @Param('id') id: string) {
    await this.missionService.delete(id, user.id);
    return { message: 'Mission deleted successfully' };
  }
}
