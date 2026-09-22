import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../user/user.entity';
import { PreventionApiService } from './prevention-api.service';
import { PreventionQueryDto, PreventionReferenceQueryDto } from './prevention-api.dto';

@Controller('prevention')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PreventionApiController {
  constructor(private readonly service: PreventionApiService) {}

  @Get('dashboard') dashboard(@CurrentUser() user: User, @Query() query: PreventionQueryDto) { return this.service.dashboard(user, query); }
  @Get('findings') findings(@CurrentUser() user: User, @Query() query: PreventionQueryDto) { return this.service.findings(user, query); }
  @Get('recommendations') recommendations(@CurrentUser() user: User, @Query() query: PreventionQueryDto) { return this.service.recommendations(user, query); }
  @Get('trends') trends(@CurrentUser() user: User, @Query() query: PreventionQueryDto) { return this.service.trends(user, query); }
  @Get('references') references(@CurrentUser() user: User, @Query() query: PreventionReferenceQueryDto) { return this.service.references(user, query); }

  @Post('rebuild') @HttpCode(HttpStatus.ACCEPTED)
  rebuild(@CurrentUser() user: User) { return this.service.rebuild(user); }

  @Get('jobs/:id') job(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.service.job(user, id); }
}
