import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/user.entity';
import { CreateOrgUserDto, HyperAdminService, UpdateOrgUserDto } from './hyper-admin.service';
import { AllowNoOrg } from '../common/decorators/scope.decorators';

@Controller('hyper-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.HYPER_ADMIN)
@AllowNoOrg()
export class HyperAdminController {
  constructor(private readonly hyperService: HyperAdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.hyperService.globalDashboard();
  }

  @Get('users')
  users() {
    return this.hyperService.allUsers();
  }

  @Post('users')
  createUser(@Body() dto: CreateOrgUserDto) {
    return this.hyperService.createUser(dto);
  }

  @Get('organizations/:orgId/users')
  orgUsers(@Param('orgId') orgId: string) {
    return this.hyperService.listOrgUsers(orgId);
  }

  @Post('organizations/:orgId/users')
  createOrgUser(@Param('orgId') orgId: string, @Body() dto: CreateOrgUserDto) {
    return this.hyperService.createOrgUser(orgId, dto);
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateOrgUserDto) {
    return this.hyperService.updateUser(id, dto);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.hyperService.deleteUser(id);
  }
}
