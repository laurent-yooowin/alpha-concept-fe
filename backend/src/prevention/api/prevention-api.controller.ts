import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PreventionActivationGuard } from '../prevention-activation.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { User, UserRole } from '../../user/user.entity';
import { PreventionApiService } from './prevention-api.service';
import { PreventionQueryDto, PreventionReferenceQueryDto } from './prevention-api.dto';
import { PreventionBudgetApiService } from './prevention-budget-api.service';
import { PreventionRebuildConfirmDto } from './prevention-rebuild.dto';
import {
  PreventionBudgetCreateDto, PreventionBudgetItemPatchDto, PreventionBudgetListQueryDto,
  PreventionBudgetClientFilterDto, PreventionBudgetItemRecalculateDto, PreventionBudgetPatchDto, PreventionBudgetRecalculateDto, PreventionBudgetScopeDto, PreventionCostCatalogCreateDto,
  PreventionCostCatalogStatusDto, PreventionBudgetPreviewDto, PreventionBudgetCommandDto,
} from './prevention-budget.dto';

@Controller('prevention')
@UseGuards(JwtAuthGuard, RolesGuard, PreventionActivationGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('reports', 'read')
export class PreventionApiController {
  constructor(private readonly service: PreventionApiService, private readonly budgets: PreventionBudgetApiService) {}

  @Get('dashboard') dashboard(@CurrentUser() user: User, @Query() query: PreventionQueryDto) { return this.service.dashboard(user, query); }
  @Get('findings') findings(@CurrentUser() user: User, @Query() query: PreventionQueryDto) { return this.service.findings(user, query); }
  @Get('recommendations') recommendations(@CurrentUser() user: User, @Query() query: PreventionQueryDto) { return this.service.recommendations(user, query); }
  @Get('categories') categories(@CurrentUser() user: User) { return this.service.categories(user); }
  @Get('trends') trends(@CurrentUser() user: User, @Query() query: PreventionQueryDto) { return this.service.trends(user, query); }
  @Get('references') references(@CurrentUser() user: User, @Query() query: PreventionReferenceQueryDto) { return this.service.references(user, query); }

  @Get('rebuild/preview') @RequirePermission('reports', 'write')
  rebuildPreview(@CurrentUser() user: User) { return this.service.rebuildPreview(user); }

  @Post('rebuild') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  rebuild(@CurrentUser() user: User, @Body() dto: PreventionRebuildConfirmDto) { return this.service.rebuild(user, dto); }

  @Get('jobs/:id') job(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.service.job(user, id); }

  @Get('budgets') budgetsList(@CurrentUser() user: User, @Query() query: PreventionBudgetListQueryDto) { return this.budgets.list(user, query); }
  @Get('budgets/clients') budgetClients(@CurrentUser() user: User) { return this.budgets.clients(user); }
  @Post('budgets/preview') @RequirePermission('reports', 'write')
  budgetPreview(@CurrentUser() user: User, @Body() dto: PreventionBudgetPreviewDto) { return this.budgets.preview(user, dto); }
  @Post('budgets/command') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  budgetCommand(@CurrentUser() user: User, @Body() dto: PreventionBudgetCommandDto) { return this.budgets.command(user, dto); }
  @Post('budgets') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  budgetsCreate(@CurrentUser() user: User, @Body() dto: PreventionBudgetCreateDto) { return this.budgets.create(user, dto); }
  @Get('budgets/scope') budgetScope(@CurrentUser() user: User, @Query() dto: PreventionBudgetScopeDto) { return this.budgets.scope(user, dto); }
  @Get('budgets/materialized') budgetMaterialized(@CurrentUser() user: User, @Query() dto: PreventionBudgetScopeDto) { return this.budgets.materialized(user, dto); }
  @Patch('budgets/materialized/:scenarioId/items/:itemId') @RequirePermission('reports', 'write')
  budgetMaterializedItemPatch(@CurrentUser() user: User, @Param('scenarioId', new ParseUUIDPipe({ version: '4' })) scenarioId: string, @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string, @Body() dto: PreventionBudgetItemPatchDto) { return this.budgets.patchMaterializedItem(user, scenarioId, itemId, dto); }
  @Post('budgets/materialized/:scenarioId/items/:itemId/recalculate') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  budgetMaterializedItemRecalculate(@CurrentUser() user: User, @Param('scenarioId', new ParseUUIDPipe({ version: '4' })) scenarioId: string, @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string, @Body() dto: PreventionBudgetItemRecalculateDto) { return this.budgets.recalculateMaterializedItem(user, scenarioId, itemId, dto); }
  @Post('budgets/scope') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  calculateBudgetScope(@CurrentUser() user: User, @Body() dto: PreventionBudgetScopeDto) { return this.budgets.scope(user, dto, true); }
  @Get('budgets/catalog') catalog(@CurrentUser() user: User) { return this.budgets.catalog(user); }
  @Get('budget-catalog') catalogAlias(@CurrentUser() user: User) { return this.budgets.catalog(user); }
  @Post('budgets/catalog') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  catalogCreate(@CurrentUser() user: User, @Body() dto: PreventionCostCatalogCreateDto) { return this.budgets.createCatalog(user, dto); }
  @Post('budget-catalog') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  catalogCreateAlias(@CurrentUser() user: User, @Body() dto: PreventionCostCatalogCreateDto) { return this.budgets.createCatalog(user, dto); }
  @Patch('budgets/catalog/:id')
  @RequirePermission('reports', 'write')
  catalogStatus(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: PreventionCostCatalogStatusDto) { return this.budgets.setCatalogStatus(user, id, dto); }
  @Patch('budget-catalog/:id')
  @RequirePermission('reports', 'write')
  catalogStatusAlias(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: PreventionCostCatalogStatusDto) { return this.budgets.setCatalogStatus(user, id, dto); }
  @Get('budgets/jobs/:id') budgetJob(@CurrentUser() user: User, @Param('id') id: string) { return this.budgets.job(user, id); }
  @Get('budget-jobs/:id') budgetJobAlias(@CurrentUser() user: User, @Param('id') id: string) { return this.budgets.job(user, id); }
  @Get('budgets/:id') budgetDetail(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Query() query: PreventionBudgetClientFilterDto) { return this.budgets.detail(user, id, query.clientKeys); }
  @Patch('budgets/:id') @RequirePermission('reports', 'write') budgetPatch(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: PreventionBudgetPatchDto) { return this.budgets.patchScenario(user, id, dto); }
  @Post('budgets/:id/recalculate') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  budgetRecalculate(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: PreventionBudgetRecalculateDto) { return this.budgets.recalculate(user, id, dto); }
  @Patch('budgets/:id/items/:itemId')
  @RequirePermission('reports', 'write')
  budgetItemPatch(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string, @Body() dto: PreventionBudgetItemPatchDto) { return this.budgets.patchItem(user, id, itemId, dto); }
  @Post('budgets/:id/items/:itemId/recalculate') @HttpCode(HttpStatus.ACCEPTED) @RequirePermission('reports', 'write')
  budgetItemRecalculate(@CurrentUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string, @Body() dto: PreventionBudgetItemRecalculateDto) { return this.budgets.recalculateItem(user, id, itemId, dto); }
}
