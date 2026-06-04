import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User, UserRole } from '../user/user.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('activity-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.HYPER_ADMIN)
  async findAll(
    @CurrentUser() user: User,
    @Query('userId') userId?: string,
  ) {
    return this.activityLogService.findAll(user, userId);
  }
}
