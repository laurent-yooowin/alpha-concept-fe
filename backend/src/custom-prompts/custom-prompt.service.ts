import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MissionType } from '../missions/mission.dto';
import { User, UserRole } from '../user/user.entity';
import { Visit } from '../visits/visit.entity';
import { CreateCustomPromptDto, UpdateCustomPromptDto } from './custom-prompt.dto';
import { CustomPrompt } from './custom-prompt.entity';

export interface ResolvedCustomPrompts {
  prompts: CustomPrompt[];
  combinedContent: string;
  missionType?: MissionType;
}

@Injectable()
export class CustomPromptService {
  constructor(
    @InjectRepository(CustomPrompt)
    private readonly repository: Repository<CustomPrompt>,
    @InjectRepository(Visit)
    private readonly visitRepository: Repository<Visit>,
  ) {}

  normalizeMissionType(value?: string): MissionType | undefined {
    if (!value) return undefined;
    if (value.toUpperCase() === 'DIVERS') return MissionType.Divers;
    if (value.toUpperCase() === 'CSPS') return MissionType.CSPS;
    if (value.toUpperCase() === 'AEU') return MissionType.AEU;
    throw new BadRequestException('Type de chantier invalide: ' + value);
  }

  private requireOrganization(user: User): string {
    if (!user.organizationId) {
      throw new ForbiddenException('Une organisation est requise');
    }
    return user.organizationId;
  }

  private requireAdmin(user: User): void {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Accès réservé aux administrateurs');
    }
  }

  async findAvailable(user: User, missionType?: string): Promise<CustomPrompt[]> {
    const organizationId = this.requireOrganization(user);
    const normalizedType = this.normalizeMissionType(missionType);
    return this.repository.find({
      where: {
        organizationId,
        isActive: true,
        ...(normalizedType ? { missionType: normalizedType } : {}),
      },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async findAllForAdmin(user: User, missionType?: string): Promise<CustomPrompt[]> {
    this.requireAdmin(user);
    const organizationId = this.requireOrganization(user);
    const normalizedType = this.normalizeMissionType(missionType);
    return this.repository.find({
      where: {
        organizationId,
        ...(normalizedType ? { missionType: normalizedType } : {}),
      },
      order: { missionType: 'ASC', displayOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(user: User, dto: CreateCustomPromptDto): Promise<CustomPrompt> {
    this.requireAdmin(user);
    const organizationId = this.requireOrganization(user);
    return this.repository.save(this.repository.create({
      ...dto,
      name: dto.name.trim(),
      organizationId,
      createdById: user.id,
    }));
  }

  async update(user: User, id: string, dto: UpdateCustomPromptDto): Promise<CustomPrompt> {
    this.requireAdmin(user);
    const prompt = await this.findOwned(user, id);
    Object.assign(prompt, dto, dto.name !== undefined ? { name: dto.name.trim() } : {});
    return this.repository.save(prompt);
  }

  async deactivate(user: User, id: string): Promise<void> {
    this.requireAdmin(user);
    const prompt = await this.findOwned(user, id);
    prompt.isActive = false;
    await this.repository.save(prompt);
  }

  private async findOwned(user: User, id: string): Promise<CustomPrompt> {
    const organizationId = this.requireOrganization(user);
    const prompt = await this.repository.findOne({ where: { id, organizationId } });
    if (!prompt) throw new NotFoundException('Prompt personnalisé introuvable');
    return prompt;
  }

  async resolveForAnalysis(
    user: User,
    customPromptIds: string[] = [],
    visitId?: string,
    requestedMissionType?: string,
  ): Promise<ResolvedCustomPrompts> {
    const organizationId = this.requireOrganization(user);
    let missionType = this.normalizeMissionType(requestedMissionType);

    if (visitId) {
      const visit = await this.visitRepository.findOne({
        where: { id: visitId, organizationId },
        relations: ['mission'],
      });
      if (!visit || (user.role === UserRole.USER && visit.userId !== user.id)) {
        throw new NotFoundException('Visite introuvable');
      }
      const visitMissionType = this.normalizeMissionType(visit.mission?.type);
      if (missionType && visitMissionType && missionType !== visitMissionType) {
        throw new BadRequestException('Le type demandé ne correspond pas à la visite');
      }
      missionType = visitMissionType;
    }

    const orderedIds = Array.from(new Set(customPromptIds || []));
    if (orderedIds.length === 0) {
      return { prompts: [], combinedContent: '', missionType };
    }
    if (!missionType) {
      throw new BadRequestException('Le type de chantier est requis avec des prompts personnalisés');
    }

    const found = await this.repository.find({
      where: {
        id: In(orderedIds),
        organizationId,
        missionType,
        isActive: true,
      },
    });
    const byId = new Map(found.map((prompt) => [prompt.id, prompt]));
    const prompts = orderedIds.map((id) => byId.get(id)).filter(Boolean) as CustomPrompt[];
    if (prompts.length !== orderedIds.length) {
      throw new BadRequestException(
        'Un ou plusieurs prompts sont indisponibles pour ce type de chantier',
      );
    }

    return {
      prompts,
      combinedContent: prompts.map((prompt) => prompt.content).join('\n\n'),
      missionType,
    };
  }
}
