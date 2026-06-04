import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Query, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import { User, UserRole } from './user.entity';
import { UpdateUserDto } from './user.dto';
import { ALL_MODULES, PERMISSION_PRESETS, PermissionLevel, UserPermissions } from '../common/permissions/permissions.types';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('profile')
  getProfile(@CurrentUser() user: User) {
    return user;
  }

  @Get()
  findAll(
    @CurrentUser() user: User,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.userService.findAll(user, organizationId);
  }

  @Post()
  @RequirePermission('users', 'write')
  async create(@Body() userData: any, @CurrentUser() current: User) {
    if (current.role !== UserRole.HYPER_ADMIN && current.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Action réservée aux admins');
    }

    if (!userData.email || !userData.password) {
      throw new BadRequestException('Email et mot de passe requis');
    }

    if (current.role !== UserRole.HYPER_ADMIN) {
      if (!current.organizationId) {
        throw new ForbiddenException('Organisation requise');
      }
      if (userData.role === UserRole.HYPER_ADMIN) {
        throw new ForbiddenException("Élévation de privilèges interdite");
      }
      userData.organizationId = current.organizationId;
      userData.role = userData.role || UserRole.USER;
    } else {
      userData.organizationId = userData.organizationId ?? null;
      userData.role = userData.role || UserRole.USER;
    }

    return this.userService.create(userData);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() current: User) {
    const target = await this.userService.findById(id);
    this.assertSameScope(current, target);
    return target;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() userData: UpdateUserDto,
    @CurrentUser() current: User,
  ) {
    const target = await this.userService.findById(id);
    this.assertSameScope(current, target);

    // Privilege escalation guard: only HYPER_ADMIN may modify role / organizationId.
    if (current.role !== UserRole.HYPER_ADMIN) {
      if (userData.role && userData.role !== target.role) {
        throw new ForbiddenException("Modification du rôle interdite");
      }
      if (userData.role === UserRole.HYPER_ADMIN) {
        throw new ForbiddenException("Élévation de privilèges interdite");
      }
      delete (userData as any).organizationId;
      delete (userData as any).role;
    } else {
      // Even hyper-admin may not demote themselves through this endpoint by accident
      if (current.id === target.id && userData.role && userData.role !== UserRole.HYPER_ADMIN) {
        throw new ForbiddenException("Vous ne pouvez pas modifier votre propre rôle");
      }
    }

    return this.userService.update(id, userData);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() current: User) {
    const target = await this.userService.findById(id);
    this.assertSameScope(current, target);
    if (current.id === target.id) {
      throw new ForbiddenException('Auto-suppression interdite');
    }
    if (target.role === UserRole.HYPER_ADMIN && current.role !== UserRole.HYPER_ADMIN) {
      throw new ForbiddenException('Action interdite');
    }
    return this.userService.delete(id);
  }

  /**
   * Update per-module permissions for a user.
   * Allowed for HYPER_ADMIN globally, or ADMIN within their organization.
   */
  @Patch(':id/permissions')
  async updatePermissions(
    @Param('id') id: string,
    @Body() body: { preset?: keyof typeof PERMISSION_PRESETS; permissions?: UserPermissions },
    @CurrentUser() current: User,
  ) {
    const target = await this.userService.findById(id);
    this.assertSameScope(current, target);

    if (target.role === UserRole.HYPER_ADMIN) {
      throw new ForbiddenException('Permissions du HYPER_ADMIN non modifiables');
    }
    if (current.role !== UserRole.HYPER_ADMIN && current.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Action réservée aux admins');
    }

    let next: UserPermissions;
    if (body.preset && PERMISSION_PRESETS[body.preset]) {
      next = { ...PERMISSION_PRESETS[body.preset] };
    } else if (body.permissions) {
      next = {};
      for (const m of ALL_MODULES) {
        const v = body.permissions[m];
        if (v === 'none' || v === 'read' || v === 'write') next[m] = v as PermissionLevel;
      }
    } else {
      throw new BadRequestException('preset ou permissions requis');
    }

    return this.userService.update(id, { permissions: next } as any);
  }

  private assertSameScope(current: User, target: User) {
    if (!target) throw new NotFoundException('User not found');
    if (current.role === UserRole.HYPER_ADMIN) return;
    if (current.id === target.id) return;
    if (
      current.role === UserRole.ADMIN &&
      target.organizationId &&
      target.organizationId === current.organizationId &&
      target.role !== UserRole.HYPER_ADMIN
    ) return;
    throw new ForbiddenException('Accès interdit à cet utilisateur');
  }
}
