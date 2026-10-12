import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PreventionApiController } from './prevention-api.controller';
import { PreventionApiService } from './prevention-api.service';
import { PreventionRebuildQueueService } from './prevention-rebuild-queue.service';
import { PreventionBudgetApiService } from './prevention-budget-api.service';
import { PreventionBudgetService } from '../budget/prevention-budget.service';
import { PreventionBudgetEstimationAiService } from '../budget/prevention-budget-estimation-ai.service';
import { PreventionObservabilityController } from '../observability/prevention-observability.controller';
import { PreventionObservabilityService } from '../observability/prevention-observability.service';
import { PreventionActivationService } from '../prevention-activation.service';
import { PreventionActivationGuard } from '../prevention-activation.guard';
import { PreventionPhaseValidationController } from './prevention-phase-validation.controller';
import { PreventionPhaseValidationService } from './prevention-phase-validation.service';
import { PreventionQueueModule } from '../queue/prevention-queue.module';
import { PreventionBulkAdmissionService } from '../scheduler/prevention-bulk-admission.service';
import { PreventionHyperAdminRecoveryService } from './prevention-hyper-admin-recovery.service';

@Module({ imports: [ConfigModule, PreventionQueueModule.register()], controllers: [PreventionApiController, PreventionPhaseValidationController, PreventionObservabilityController], providers: [PreventionApiService, PreventionRebuildQueueService, PreventionBulkAdmissionService, PreventionBudgetApiService, PreventionBudgetService, PreventionBudgetEstimationAiService, PreventionObservabilityService, PreventionActivationService, PreventionActivationGuard, PreventionPhaseValidationService, PreventionHyperAdminRecoveryService], exports: [PreventionRebuildQueueService, PreventionBudgetService, PreventionBulkAdmissionService, PreventionObservabilityService, PreventionHyperAdminRecoveryService] })
export class PreventionApiModule {}
