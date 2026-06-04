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
  getStats(@CurrentUser() user: User) {
    return this.dashboardService.getStats(user);
  }

  @Get('monthly-missions')
  getMonthlyMissions(@CurrentUser() user: User) {
    return this.dashboardService.getMonthlyMissions(user);
  }

  @Get('coordinator-stats')
  getCoordinatorStats(@CurrentUser() user: User) {
    return this.dashboardService.getCoordinatorStats(user);
  }

  @Get('status-breakdown')
  getStatusBreakdown(@CurrentUser() user: User) {
    return this.dashboardService.getStatusBreakdown(user);
  }
}
