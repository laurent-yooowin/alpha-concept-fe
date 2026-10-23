import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../../user/user.entity';
import { PreventionActivationService } from '../prevention-activation.service';
import {
  isPreventionConstructionPhase,
  isPreventionEffectivePhase,
  normalizePreventionPhaseLabel,
  PREVENTION_CONSTRUCTION_PHASES,
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

  async catalog(user: User) {
    if (!user.organizationId || (user.role !== UserRole.USER && user.role !== UserRole.ADMIN)) {
      throw new ForbiddenException('Rôle non autorisé');
    }
    await this.activation.assertEnabled(user.organizationId);
    const custom: Array<{ code: string; label: string }> = await this.db.query(
      'SELECT code,label FROM prevention_phase_catalog ORDER BY label ASC',
    );
    return [
      ...PREVENTION_CONSTRUCTION_PHASES.map((value) => ({ value, label: PREVENTION_PHASE_LABELS[value], custom: false })),
      ...custom.map((row) => ({ value: row.code, label: row.label, custom: true })),
    ];
  }

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
      `SELECT j.sourceGroupId,j.processingStatus,j.phaseStatus,j.proposedPhase,j.effectivePhase,j.confidence,j.justification,j.attempts,
              c.label AS customPhaseLabel,
              CASE WHEN j.lastError IS NULL THEN NULL ELSE 'PREVENTION_RETRY_ERROR' END AS lastErrorCode,j.updatedAt
       FROM prevention_group_processing_jobs j
       LEFT JOIN prevention_phase_catalog c ON c.code=j.effectivePhase
       WHERE j.organizationId=? AND j.visitId=? AND j.sourceGroupId=? LIMIT 1`,
      [user.organizationId, visitId, sourceGroupId],
    );
    if (!row) throw new NotFoundException('Groupe de traitement Prévention introuvable');
    const { customPhaseLabel, ...status } = row;
    return {
      ...status,
      proposedPhaseLabel: isPreventionConstructionPhase(row.proposedPhase) ? PREVENTION_PHASE_LABELS[row.proposedPhase] : null,
      effectivePhaseLabel: isPreventionConstructionPhase(row.effectivePhase)
        ? PREVENTION_PHASE_LABELS[row.effectivePhase] : customPhaseLabel ?? null,
    };
  }

  async validate(user: User, visitId: string, sourceGroupId: string, dto: PreventionPhaseValidationDto) {
    if (!user.organizationId) throw new ForbiddenException('Organisation requise');
    if (!visitId || visitId.length > 36 || !sourceGroupId || sourceGroupId.length > 100) {
      throw new BadRequestException('Identifiant de visite ou de groupe invalide');
    }
    if (!dto || typeof dto !== 'object') throw new BadRequestException('Sélection de phase requise');
    const phase = typeof dto.phase === 'string' ? dto.phase.trim() : '';
    const customLabel = typeof dto.customPhaseLabel === 'string'
      ? dto.customPhaseLabel.trim().replace(/\s+/g, ' ') : '';
    if (Boolean(phase) === Boolean(customLabel)) {
      throw new BadRequestException('Choisissez une phase existante ou saisissez une nouvelle phase');
    }
    if (phase && !isPreventionEffectivePhase(phase)) throw new BadRequestException('Phase inconnue');
    if (customLabel && (customLabel.length < 3 || customLabel.length > 80 ||
      /[\u0000-\u001f\u007f<>]/.test(customLabel))) {
      throw new BadRequestException('Libellé de phase invalide');
    }
    const labelKey = customLabel ? normalizePreventionPhaseLabel(customLabel) : '';
    if (labelKey.length > 160) throw new BadRequestException('Libellé de phase invalide');
    if (customLabel && PREVENTION_CONSTRUCTION_PHASES.some((value) =>
      normalizePreventionPhaseLabel(PREVENTION_PHASE_LABELS[value]) === labelKey)) {
      throw new BadRequestException('Cette phase existe déjà dans le catalogue');
    }
    await this.activation.assertEnabled(user.organizationId);
    return this.db.transaction(async (manager) => {
      if (customLabel) {
        // Serialize this user's daily quota across different visits and groups.
        const [actor] = await manager.query(
          'SELECT id FROM users WHERE id=? AND organizationId=? FOR UPDATE',
          [user.id, user.organizationId],
        );
        if (!actor) throw new ForbiddenException('Utilisateur non autorisé');
      }
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
      let effectivePhase = phase;
      let effectivePhaseLabel = isPreventionConstructionPhase(phase) ? PREVENTION_PHASE_LABELS[phase] : '';
      if (phase && !effectivePhaseLabel) {
        const [existing] = await manager.query(
          'SELECT label FROM prevention_phase_catalog WHERE code=? LIMIT 1', [phase],
        );
        if (!existing) throw new BadRequestException('Phase inconnue');
        effectivePhaseLabel = existing.label;
      }
      if (customLabel) {
        const [alreadyCataloged] = await manager.query(
          'SELECT code,label FROM prevention_phase_catalog WHERE labelKey=? LIMIT 1', [labelKey],
        );
        if (!alreadyCataloged) {
          const [quota] = await manager.query(
            'SELECT COUNT(*) AS count FROM prevention_phase_catalog WHERE createdBy=? AND createdAt>=UTC_TIMESTAMP(6)-INTERVAL 1 DAY',
            [user.id],
          );
          if (Number(quota?.count ?? 0) >= 20) {
            throw new HttpException('Limite de création de phases atteinte pour aujourd’hui', HttpStatus.TOO_MANY_REQUESTS);
          }
        }
        const newCode = `CUSTOM_${randomUUID()}`;
        await manager.query(
          `INSERT INTO prevention_phase_catalog (code,label,labelKey,createdBy,createdFromOrganizationId,createdAt)
           VALUES (?,?,?,?,?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE code=code`,
          [newCode, customLabel, labelKey, user.id, user.organizationId],
        );
        const [stored] = await manager.query(
          'SELECT code,label FROM prevention_phase_catalog WHERE labelKey=? LIMIT 1', [labelKey],
        );
        if (!stored) throw new BadRequestException('La phase personnalisée est indisponible');
        effectivePhase = stored.code;
        effectivePhaseLabel = stored.label;
      }

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
          [effectivePhase, user.id, now, group.id, user.organizationId],
        );
      }
      if (this.groupProcessing) {
        await this.groupProcessing.markValidated(
          user.organizationId,
          visitId,
          sourceGroupId,
          effectivePhase,
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
        effectivePhase,
        effectivePhaseLabel,
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
