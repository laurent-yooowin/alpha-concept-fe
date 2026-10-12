import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../../user/user.entity';
import { PreventionActivationService } from '../prevention-activation.service';
import {
  isPreventionConstructionPhase,
  PREVENTION_PHASE_LABELS,
} from '../prevention-phase';
import { PreventionPhaseValidationDto } from './prevention-phase-validation.dto';
import { PreventionGroupProcessingService } from '../worker/prevention-group-processing.service';

@Injectable()
export class PreventionPhaseValidationService {
  constructor(
    private readonly db: DataSource,
    private readonly activation: PreventionActivationService,
    @Optional() private readonly groupProcessing?: PreventionGroupProcessingService,
  ) {}

  async backfill(user: User, cursor?: string) {
    if (!user.organizationId || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Réservé à l’administrateur de l’organisation');
    }
    await this.activation.assertEnabled(user.organizationId);
    if (cursor && (cursor.length > 36 || !/^[0-9a-f-]+$/i.test(cursor))) {
      throw new BadRequestException('Curseur invalide');
    }
    if (!this.groupProcessing) throw new BadRequestException('Le traitement Prévention est indisponible');
    return this.groupProcessing.backfillOrganization(user.organizationId, 100, cursor);
  }

  async status(user: User, visitId: string, sourceGroupId: string) {
    if (!user.organizationId) throw new ForbiddenException('Organisation requise');
    if (!visitId || visitId.length > 36 || !sourceGroupId || sourceGroupId.length > 100) {
      throw new BadRequestException('Identifiant de visite ou de groupe invalide');
    }
    await this.activation.assertEnabled(user.organizationId);
    if (user.role !== UserRole.USER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Rôle non autorisé');
    }
    const [visit] = await this.db.query(
      `SELECT userId FROM visits WHERE id=? AND organizationId=? LIMIT 1`, [visitId, user.organizationId],
    );
    if (!visit) throw new NotFoundException('Visite introuvable');
    if (user.role === UserRole.USER && visit.userId !== user.id) throw new ForbiddenException('Cette visite ne vous est pas attribuée');
    const [row] = await this.db.query(
      `SELECT sourceGroupId,processingStatus,phaseStatus,proposedPhase,effectivePhase,confidence,justification,attempts,
              CASE WHEN lastError IS NULL THEN NULL ELSE 'PREVENTION_RETRY_ERROR' END AS lastErrorCode,updatedAt
       FROM prevention_group_processing_jobs WHERE organizationId=? AND visitId=? AND sourceGroupId=? LIMIT 1`,
      [user.organizationId, visitId, sourceGroupId],
    );
    if (!row) throw new NotFoundException('Groupe de traitement Prévention introuvable');
    return row;
  }

  async validate(user: User, visitId: string, sourceGroupId: string, dto: PreventionPhaseValidationDto) {
    if (!user.organizationId) throw new ForbiddenException('Organisation requise');
    if (!visitId || visitId.length > 36 || !sourceGroupId || sourceGroupId.length > 100) {
      throw new BadRequestException('Identifiant de visite ou de groupe invalide');
    }
    await this.activation.assertEnabled(user.organizationId);
    return this.db.transaction(async (manager) => {
      const [visit] = await manager.query(
        `SELECT v.id,v.organizationId,v.missionId,v.userId,v.photos
         FROM visits v
         WHERE v.organizationId=? AND v.id=?
         LIMIT 1 FOR UPDATE`,
        [user.organizationId, visitId],
      );
      if (!visit) throw new NotFoundException('Visite introuvable');
      if (user.role === UserRole.USER && visit.userId !== user.id) {
        throw new ForbiddenException('Cette visite ne vous est pas attribuée');
      }
      if (user.role !== UserRole.USER && user.role !== UserRole.ADMIN) {
        throw new ForbiddenException('Rôle non autorisé');
      }
      let photos: unknown = visit.photos;
      if (typeof photos === 'string') {
        try { photos = JSON.parse(photos); } catch { photos = []; }
      }
      if (!Array.isArray(photos)) throw new NotFoundException('Groupe d’analyse introuvable');

      const matchingEntries = photos.filter((entry: any, index: number) => {
        const entryGroupId = typeof entry?.groupId === 'string' && entry.groupId
          ? entry.groupId : (typeof entry?.id === 'string' ? entry.id : `entry-${index}`);
        return entryGroupId === sourceGroupId;
      });
      const sourceAnalysis = matchingEntries.find((entry: any) => entry?.analysis)?.analysis;
      const [processing] = await manager.query(
        `SELECT sourceHash,sourceKind,processingStatus,proposedPhase,confidence,justification,riskAssessments
         FROM prevention_group_processing_jobs
         WHERE organizationId=? AND visitId=? AND sourceGroupId=? LIMIT 1 FOR UPDATE`,
        [user.organizationId, visitId, sourceGroupId],
      );
      if (!sourceAnalysis || !processing || processing.processingStatus !== 'READY' ||
          !isPreventionConstructionPhase(processing.proposedPhase) || !this.groupProcessing) {
        throw new BadRequestException('Le traitement Prévention du groupe doit être terminé avant validation de sa phase');
      }
      const proposedPhase = processing.proposedPhase;

      const [group] = await manager.query(
        `SELECT g.id,g.proposedPhase,g.effectivePhase,g.status,g.confidence,g.justification,
                g.source,g.modelVersion
         FROM prevention_analysis_groups g
         WHERE g.organizationId=? AND g.visitId=? AND g.sourceGroupId=?
         LIMIT 1 FOR UPDATE`,
        [user.organizationId, visitId, sourceGroupId],
      );
      const now = new Date();
      if (group) {
        await manager.query(
          `UPDATE prevention_analysis_groups
           SET effectivePhase=?,status='VALIDATED',validatedBy=?,validatedAt=?
           WHERE id=? AND organizationId=?`,
          [dto.phase, user.id, now, group.id, user.organizationId],
        );
      }
      if (this.groupProcessing) {
        await this.groupProcessing.markValidated(
          user.organizationId,
          visitId,
          sourceGroupId,
          dto.phase,
          user.id,
          now,
          manager,
        );
      }

      const confidence = processing.confidence;
      const justification = processing.justification;
      const source = group?.source ?? processing.sourceKind;
      return {
        id: group?.id ?? null,
        visitId,
        sourceGroupId,
        proposedPhase: group?.proposedPhase ?? proposedPhase,
        effectivePhase: dto.phase,
        effectivePhaseLabel: PREVENTION_PHASE_LABELS[dto.phase],
        status: 'VALIDATED',
        confidence: Number(confidence),
        justification,
        source,
        modelVersion: group?.modelVersion ?? null,
        validatedBy: user.id,
        validatedAt: now,
      };
    });
  }
}
