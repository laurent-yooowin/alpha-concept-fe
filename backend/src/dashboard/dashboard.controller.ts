import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../user/user.entity';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  async getStats(@CurrentUser() user: User) {
    return this.dashboardService.getStats(user.id, user.role);
  }

  @Get('monthly-missions')
  async getMonthlyMissions(@CurrentUser() user: User) {
    return this.dashboardService.getMonthlyMissions(user.id, user.role);
  }

  @Get('coordinator-stats')
  async getCoordinatorStats(@CurrentUser() user: User) {
    return this.dashboardService.getCoordinatorStats(user.id, user.role);
  }

  @Get('status-breakdown')
  async getStatusBreakdown(@CurrentUser() user: User) {
    return this.dashboardService.getStatusBreakdown(user.id, user.role);
  }
}
