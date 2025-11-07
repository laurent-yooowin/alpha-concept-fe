import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MissionService } from './mission.service';
import { CreateMissionDto, UpdateMissionDto } from './mission.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, UserRole } from '../user/user.entity';

@Controller('missions')
@UseGuards(JwtAuthGuard)
export class MissionController {
  constructor(private readonly missionService: MissionService) {}

  @Post()
  async create(
    @CurrentUser() user: User,
    @Body() createMissionDto: CreateMissionDto,
  ) {
    return this.missionService.create(user, createMissionDto);
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
    return this.missionService.assignUsers(id, body.userIds, user);
  }

  @Get(':id/assigned-users')
  async getAssignedUsers(@Param('id') id: string) {
    return this.missionService.getAssignedUsers(id);
  }

  @Delete(':id/assign/:userId')
  async removeAssignment(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    await this.missionService.removeAssignment(id, userId, user);
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

  @Post('bulk-import')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const result = await this.missionService.bulkImport(file, user);

    return {
      success: true,
      message: `Import completed. ${result.imported.length} missions imported, ${result.ignored.length} ignored, ${result.errors.length} errors.`,
      data: {
        imported: result.imported,
        ignoredMissions: result.ignored,
        errors: result.errors,
        summary: {
          total: result.imported.length + result.ignored.length + result.errors.length,
          imported: result.imported.length,
          ignored: result.ignored.length,
          failed: result.errors.length,
        },
      },
    };
  }
}
