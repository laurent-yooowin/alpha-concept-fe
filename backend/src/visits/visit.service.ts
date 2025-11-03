import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visit } from './visit.entity';
import { CreateVisitDto, UpdateVisitDto } from './visit.dto';
import { User, UserRole } from '../user/user.entity';
import { MissionService } from '../missions/mission.service';
import { UpdateMissionData } from '../../../services/missionService';
import { UpdateMissionDto } from '../missions/mission.dto';

@Injectable()
export class VisitService {
  constructor(
    @InjectRepository(Visit)
    private visitRepository: Repository<Visit>,
    private missionService: MissionService
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
      photoCount: createVisitDto.photos?.length || 0,
      visitDate: new Date(createVisitDto.visitDate),
    });

    if (mission && (mission.status === 'planifiee' || mission.status === 'assignee')) {
      const updateMissionDto = new UpdateMissionDto();
      updateMissionDto.status = 'en_cours';
      await this.missionService.update(mission.id, user.id, updateMissionDto);
    }

    return this.visitRepository.save(visit);
  }

  async findAll(user: User, missionId?: string): Promise<Visit[]> {
    const where: any = {};

    if (user.role !== UserRole.ADMIN) {
      where.userId = user.id;
    }

    if (missionId) {
      where.missionId = missionId;
    }

    return this.visitRepository.find({
      where,
      relations: ['mission', 'user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByMission(missionId: string, user: User): Promise<Visit[]> {
    const where: any = { missionId };

    if (user.role !== UserRole.ADMIN) {
      where.userId = user.id;
    }

    return this.visitRepository.find({
      where,
      relations: ['user'],
      order: { visitDate: 'DESC' },
    });
  }

  async findOne(id: string, user: User): Promise<Visit> {
    const where: any = { id };

    if (user.role !== UserRole.ADMIN) {
      where.userId = user.id;
    }

    const visit = await this.visitRepository.findOne({
      where,
      relations: ['mission', 'user'],
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
}
