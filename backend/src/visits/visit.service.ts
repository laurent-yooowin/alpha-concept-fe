import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { orgScope } from '../common/utils/org-scope';
import { Visit } from './visit.entity';
import { CreateVisitDto, UpdateVisitDto } from './visit.dto';
import { User, UserRole } from '../user/user.entity';
import { MissionService } from '../missions/mission.service';
import { MissionStatus, UpdateMissionDto } from '../missions/mission.dto';
import { ReportService } from '../reports/report.service';
import { CreateReportDto } from '../reports/report.dto';
import { ReportStatus } from '../reports/report.entity';

@Injectable()
export class VisitService {
  constructor(
    @InjectRepository(Visit)
    private visitRepository: Repository<Visit>,

    @Inject(forwardRef(() => MissionService))
    private missionService: MissionService,

    @Inject(forwardRef(() => ReportService))
    private reportService: ReportService,
  ) { }

  async create(user: User, createVisitDto: CreateVisitDto): Promise<Visit> {
    const userId = user.id;
    const mission = await this.missionService.findOne(createVisitDto.missionId, user);
    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    if (mission.status === 'terminee' || mission.status === 'annulee' || mission.status === 'validee') {
      throw new NotFoundException('Cannot add visit to a completed mission');
    }

    if (mission.userId !== userId && user.role !== UserRole.ADMIN) {
      throw new NotFoundException('You are not assigned to this mission');
    }

    const visit = this.visitRepository.create({
      ...createVisitDto,
      userId,
      organizationId: user.organizationId,
      photoCount: createVisitDto.photos?.length || 0,
      visitDate: new Date(createVisitDto.visitDate),
    });

    if (mission && (mission.status === 'planifiee' || mission.status === 'assignee')) {
      const updateMissionDto = new UpdateMissionDto();
      updateMissionDto.status = MissionStatus.IN_PROGRESS;
      await this.missionService.update(mission.id, user, updateMissionDto);
    }

    return this.visitRepository.save(visit);
  }

  async findAll(user: User, missionId?: string): Promise<Visit[]> {
    const where: any = orgScope(user);

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    if (missionId) {
      where.missionId = missionId;
    }

    return this.visitRepository.find({
      where,
      relations: ['mission', 'user', 'report'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByMission(missionId: string, user: User): Promise<Visit[]> {
    const where: any = orgScope(user, { missionId });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    return this.visitRepository.find({
      where,
      order: { visitDate: 'DESC' },
    });
  }

  async findOne(id: string, user: User): Promise<Visit> {
    const where: any = orgScope(user, { id });

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      where.userId = user.id;
    }

    const visit = await this.visitRepository.findOne({
      where,
      relations: ['mission', 'user', 'report'],
    });

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    return visit;
  }

  async update(id: string, user: User, updateVisitDto: UpdateVisitDto): Promise<Visit> {
    const visit = await this.findOne(id, user);

    if (updateVisitDto.photos) {
      updateVisitDto['photoCount'] = updateVisitDto.photos.length;
    }

    if (updateVisitDto.visitDate) {
      updateVisitDto['visitDate'] = new Date(updateVisitDto.visitDate);
    }

    Object.assign(visit, updateVisitDto);
    return this.visitRepository.save(visit);
  }

  async delete(id: string, user: User): Promise<void> {
    const visit = await this.findOne(id, user);
    await this.visitRepository.remove(visit);
  }

  /**
   * Generate a report from a visit's grouped photos.
   * Groups photos by groupId, builds report content from AI analyses,
   * and creates a Report entity linked to this visit and mission.
   */
  async generateReportFromVisit(
    visitId: string,
    user: User,
    options?: { header?: string; footer?: string; notes?: string },
  ) {
    const visit = await this.findOne(visitId, user);
    const mission = visit.mission;

    if (!visit.photos || visit.photos.length === 0) {
      throw new NotFoundException('No photos found in this visit to generate a report');
    }

    // Group photos by groupId
    const groups: { [key: string]: typeof visit.photos } = {};
    visit.photos.forEach(photo => {
      const gid = (photo as any).groupId || photo.id;
      if (!groups[gid]) groups[gid] = [];
      groups[gid].push(photo);
    });

    // Build report content from grouped photos
    let groupIndex = 0;
    const photoEntries = visit.photos.filter(p => !(p as any).isDirectiveOnly);
    const directiveEntries = visit.photos.filter(p => (p as any).isDirectiveOnly);
    const highRisks = visit.photos.filter(p => p.analysis?.riskLevel === 'eleve').length;
    const mediumRisks = visit.photos.filter(p => p.analysis?.riskLevel === 'moyen').length;

    const reportContent = Object.entries(groups).map(([groupId, groupPhotos]) => {
      groupIndex++;
      const firstPhoto = groupPhotos[0];
      const isDirectiveOnly = (firstPhoto as any).isDirectiveOnly || false;

      // Separate original photos from readability/detail photos
      const originalPhotos = groupPhotos.filter(p => !(p as any).isDetailPhoto && !(p as any).isReadabilityPhoto);
      const readabilityPhotos = groupPhotos.filter(p => (p as any).isDetailPhoto || (p as any).isReadabilityPhoto);
      const allPhotosInGroup = groupPhotos;

      if (isDirectiveOnly) {
        const observations = firstPhoto.analysis?.observation;
        const recommendations = firstPhoto.analysis?.recommendation;
        const references = firstPhoto.analysis?.references;
        const riskLevel = firstPhoto.analysis?.riskLevel?.toUpperCase() || 'N/A';

        const obsList = Array.isArray(observations) ? observations : (observations ? [observations] : []);
        const recList = Array.isArray(recommendations) ? recommendations : (recommendations ? [recommendations] : []);
        const refList = Array.isArray(references) ? references : (references ? [references] : []);

        return `━━━━━━━━━━━━━━━━━━━━━
Rapport ${groupIndex} - Directives du coordonnateur (sans photo) - Niveau de risque: ${riskLevel}

Observations:
${obsList.length > 0 ? obsList.map(obs => `• ${obs}`).join('\n') : `• ${(firstPhoto as any).userDirectives || 'Aucune observation'}`}

Recommandations:
${recList.map(rec => `• ${rec}`).join('\n')}

🏛️ Références:
${refList.map(ref => `• ${ref}`).join('\n')}

📋 Directives:
${(firstPhoto as any).userDirectives || ''}

💬 Commentaires:
${firstPhoto.comment || ''}
`;
      }

      const riskLevel = firstPhoto.analysis?.riskLevel?.toUpperCase() || 'N/A';
      const observations = firstPhoto.analysis?.observation;
      const recommendations = firstPhoto.analysis?.recommendation;
      const references = firstPhoto.analysis?.references;

      const obsList = Array.isArray(observations) ? observations : (observations ? [observations] : []);
      const recList = Array.isArray(recommendations) ? recommendations : (recommendations ? [recommendations] : []);
      const refList = Array.isArray(references) ? references : (references ? [references] : []);

      // Include all photos (original + readability) in the report
      const photoLines = originalPhotos.map(p => `📸 Photo: ${p.uri}`);
      if (readabilityPhotos.length > 0) {
        photoLines.push(...readabilityPhotos.map(p => `📸 Photo complémentaire (lisibilité): ${p.uri}`));
      }

      return `━━━━━━━━━━━━━━━━━━━━━
Rapport ${groupIndex} - ${allPhotosInGroup.length} photo(s) - Niveau de risque: ${riskLevel}
${photoLines.join('\n')}

Observations:
${obsList.map(obs => `• ${obs}`).join('\n')}

Recommandations:
${recList.map(rec => `• ${rec}`).join('\n')}

🏛️ Références:
${refList.map(ref => `• ${ref}`).join('\n')}

📋 Directives:
${(firstPhoto as any).userDirectives || ''}

💬 Commentaires:
${firstPhoto.comment || ''}
`;
    }).join('\n');

    const header = options?.header || `RAPPORT DE VISITE SPS
${mission?.title || 'Chantier sans nom'}

CLIENT: ${mission?.client || 'N/A'}
LIEU: ${mission?.address || 'N/A'}
DATE: ${new Date().toLocaleDateString('fr-FR')}

RÉSUMÉ DE LA VISITE:
${photoEntries.length} photos prises et analysées
${directiveEntries.length} rapport(s) directive(s)
${highRisks} risques élevés identifiés
${mediumRisks} risques moyens identifiés`;

    const footer = options?.footer || `CONCLUSION:
${highRisks > 0
        ? 'Des actions correctives immédiates sont nécessaires pour les risques élevés identifiés.'
        : mediumRisks > 0
          ? 'Quelques améliorations sont recommandées pour optimiser la sécurité.'
          : 'Le chantier présente un bon niveau de conformité sécurité.'
      }

Date: ${new Date().toLocaleDateString('fr-FR')}`;

    // Check if a report already exists for this visit
    const existingReport = await this.reportService.findByVisit(visitId, user);

    if (existingReport) {
      // Update existing report
      return this.reportService.update(existingReport.id, user, {
        content: reportContent,
        header,
        footer,
      });
    }

    // Create new report
    const createReportDto: CreateReportDto = {
      missionId: visit.missionId,
      visitId: visit.id,
      title: `Rapport de visite - ${mission?.title || 'Sans titre'} - ${new Date().toLocaleDateString('fr-FR')}`,
      content: reportContent,
      header,
      footer,
      status: ReportStatus.DRAFT,
      conformityPercentage: highRisks > 0 ? 50 : mediumRisks > 0 ? 75 : 95,
    };

    const report = await this.reportService.create(user, createReportDto);

    // Mark visit as report generated without re-saving loaded relations.
    // Re-saving the whole visit entity on first generation can cause TypeORM
    // to null the inverse one-to-one relation and emit `reports.visitId = null`.
    await this.visitRepository.update(visit.id, { reportGenerated: true });

    return report;
  }
}
