import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visit } from './visit.entity';
import { CreateVisitDto, UpdateVisitDto } from './visit.dto';
import { User, UserRole } from '../user/user.entity';

@Injectable()
export class VisitService {
  constructor(
    @InjectRepository(Visit)
    private visitRepository: Repository<Visit>,
  ) {}

  async create(userId: string, createVisitDto: CreateVisitDto): Promise<Visit> {
    const visit = this.visitRepository.create({
      ...createVisitDto,
      userId,
      photoCount: createVisitDto.photos?.length || 0,
      visitDate: new Date(createVisitDto.visitDate),
    });

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
