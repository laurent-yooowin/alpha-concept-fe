import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { User, UserRole } from '../../user/user.entity';
import { PreventionActivationGuard } from '../prevention-activation.guard';
import { PreventionPhaseValidationDto } from './prevention-phase-validation.dto';
import { PreventionPhaseValidationService } from './prevention-phase-validation.service';

@Controller('prevention/visits')
@UseGuards(JwtAuthGuard, RolesGuard, PreventionActivationGuard)
@Roles(UserRole.USER, UserRole.ADMIN)
@RequirePermission('visits', 'read')
export class PreventionPhaseValidationController {
  constructor(private readonly service: PreventionPhaseValidationService) {}

  @Patch(':visitId/groups/:groupId/phase')
  @RequirePermission('visits', 'write')
  validate(
    @CurrentUser() user: User,
    @Param('visitId') visitId: string,
    @Param('groupId') groupId: string,
    @Body() dto: PreventionPhaseValidationDto,
  ) {
    return this.service.validate(user, visitId, groupId, dto);
  }

  @Post('backfill')
  @RequirePermission('visits', 'write')
  backfill(@CurrentUser() user: User, @Query('cursor') cursor?: string) {
    return this.service.backfill(user, cursor);
  }

  @Get(':visitId/groups/:groupId/status')
  status(
    @CurrentUser() user: User,
    @Param('visitId') visitId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.service.status(user, visitId, groupId);
  }
}
