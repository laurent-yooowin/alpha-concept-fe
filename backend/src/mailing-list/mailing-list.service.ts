import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailingListEntry } from './mailing-list.entity';
import { CreateMailingListEntryDto, UpdateMailingListEntryDto, BulkMailingListEntryDto } from './mailing-list.dto';
import { User, UserRole } from '../user/user.entity';
import { Mission } from '../missions/mission.entity';

@Injectable()
export class MailingListService {
  constructor(
    @InjectRepository(MailingListEntry)
    private readonly repo: Repository<MailingListEntry>,
    @InjectRepository(Mission)
    private readonly missionRepo: Repository<Mission>,
  ) {}

  private ensureOrg(user: User): string {
    if (!user.organizationId) {
      throw new ForbiddenException("Aucune organisation associée à l'utilisateur");
    }
    return user.organizationId;
  }

  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      throw new ForbiddenException("Seul un administrateur peut modifier la liste de diffusion");
    }
  }

  private async ensureMission(user: User, missionId: string): Promise<Mission> {
    const organizationId = this.ensureOrg(user);
    const mission = await this.missionRepo.findOne({ where: { id: missionId, organizationId } });
    if (!mission) {
      throw new BadRequestException('Chantier introuvable pour cette organisation');
    }
    return mission;
  }

  async findAll(user: User): Promise<MailingListEntry[]> {
    const organizationId = this.ensureOrg(user);
    return this.repo.find({
      where: { organizationId },
      relations: ['mission'],
      order: { createdAt: 'DESC' },
    });
  }

  async findAllByOrg(organizationId: string): Promise<MailingListEntry[]> {
    if (!organizationId) return [];
    return this.repo.find({ where: { organizationId } });
  }

  async findByMission(user: User, missionId: string): Promise<MailingListEntry[]> {
    const organizationId = this.ensureOrg(user);
    await this.ensureMission(user, missionId);
    return this.repo.find({
      where: { organizationId, missionId },
      order: { createdAt: 'DESC' },
    });
  }

  async findMissionOptions(user: User): Promise<Array<Pick<Mission, 'id' | 'title' | 'client'>>> {
    const organizationId = this.ensureOrg(user);
    return this.missionRepo.find({
      where: { organizationId },
      select: ['id', 'title', 'client'],
      order: { createdAt: 'DESC' },
    });
  }

  async create(user: User, dto: CreateMailingListEntryDto): Promise<MailingListEntry> {
    const organizationId = this.ensureOrg(user);
    await this.ensureMission(user, dto.missionId);
    const email = dto.email.trim().toLowerCase();
    const existing = await this.repo.findOne({ where: { organizationId, missionId: dto.missionId, email } });
    if (existing) {
      throw new BadRequestException(`L'email ${email} existe déjà pour ce chantier`);
    }
    const entry = this.repo.create({
      organizationId,
      missionId: dto.missionId,
      email,
      name: dto.name?.trim() || null,
    });
    return this.repo.save(entry);
  }

  async update(user: User, id: string, dto: UpdateMailingListEntryDto): Promise<MailingListEntry> {
    this.ensureAdmin(user);
    const organizationId = this.ensureOrg(user);
    const entry = await this.repo.findOne({ where: { id, organizationId } });
    if (!entry) throw new NotFoundException('Entrée introuvable');
    const nextMissionId = dto.missionId !== undefined ? dto.missionId : entry.missionId;
    if (!nextMissionId) {
      throw new BadRequestException('Un chantier doit être sélectionné');
    }
    if (dto.missionId !== undefined) {
      await this.ensureMission(user, dto.missionId);
      entry.missionId = dto.missionId;
    }
    if (dto.email !== undefined) entry.email = dto.email.trim().toLowerCase();
    if (dto.name !== undefined) entry.name = dto.name?.trim() || null;

    const duplicate = await this.repo.findOne({
      where: { organizationId, missionId: nextMissionId, email: entry.email },
    });
    if (duplicate && duplicate.id !== entry.id) {
      throw new BadRequestException(`L'email ${entry.email} existe déjà pour ce chantier`);
    }
    return this.repo.save(entry);
  }

  async remove(user: User, id: string): Promise<void> {
    this.ensureAdmin(user);
    const organizationId = this.ensureOrg(user);
    const entry = await this.repo.findOne({ where: { id, organizationId } });
    if (!entry) throw new NotFoundException('Entrée introuvable');
    await this.repo.remove(entry);
  }

  async bulkCreate(
    user: User,
    missionId: string,
    entries: BulkMailingListEntryDto[],
  ): Promise<{ added: number; skipped: number }> {
    this.ensureAdmin(user);
    const organizationId = this.ensureOrg(user);
    await this.ensureMission(user, missionId);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const existing = await this.repo.find({ where: { organizationId, missionId } });
    const existingSet = new Set(existing.map((e) => e.email.toLowerCase()));
    const toInsert: MailingListEntry[] = [];
    let skipped = 0;
    const seen = new Set<string>();
    for (const item of entries) {
      if (!item?.email) { skipped++; continue; }
      const email = item.email.trim().toLowerCase();
      if (!emailRe.test(email) || existingSet.has(email) || seen.has(email)) {
        skipped++;
        continue;
      }
      seen.add(email);
      toInsert.push(this.repo.create({ organizationId, missionId, email, name: item.name?.trim() || null }));
    }
    if (toInsert.length) await this.repo.save(toInsert);
    return { added: toInsert.length, skipped };
  }

  async getCcEmailsForOrg(organizationId: string | null | undefined, missionId?: string | null): Promise<string[]> {
    if (!organizationId) return [];
    const where = missionId ? { organizationId, missionId } : { organizationId };
    const list = await this.repo.find({ where });
    return list.map((e) => e.email);
  }
}
