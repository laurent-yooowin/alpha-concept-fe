import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Mission } from './mission.entity';
import { MissionAssignment } from './mission-assignment.entity';
import { CreateMissionDto, UpdateMissionDto } from './mission.dto';
import { User, UserRole } from '../user/user.entity';
import { UserService } from '../user/user.service';

@Injectable()
export class MissionService {
  constructor(
    @InjectRepository(Mission)
    private missionRepository: Repository<Mission>,
    @InjectRepository(MissionAssignment)
    private assignmentRepository: Repository<MissionAssignment>,
    private userService: UserService,
  ) { }
  private readonly logger = new Logger(MissionService.name);

  async create(user: User, createMissionDto: CreateMissionDto): Promise<Mission> {
    let userId = user.id;
    if (createMissionDto.userId && user.role == UserRole.ADMIN) {
      const userDb = this.userService.findById(createMissionDto.userId);
      if (userDb) {
        userId = createMissionDto.userId;
      }
    }
    const mission = this.missionRepository.create({
      ...createMissionDto,
      status: createMissionDto.status || 'planifiee',
      userId,
    });
    return this.missionRepository.save(mission);
  }

  async findAll(user: User): Promise<Mission[]> {
    if (user.role === UserRole.ADMIN) {
      return this.missionRepository.find({
        relations: ['user'],
        order: { createdAt: 'DESC' },
      });
    }

    const assignments = await this.assignmentRepository.find({
      where: { userId: user.id },
      relations: ['mission'],
    });

    const assignedMissionIds = assignments.map(a => a.missionId);
    const userMissions = await this.missionRepository.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });

    if (assignedMissionIds.length > 0) {
      const assignedMissions = await this.missionRepository.find({
        where: { id: In(assignedMissionIds) },
        order: { createdAt: 'DESC' },
      });
      return [...userMissions, ...assignedMissions];
    }

    return userMissions;
  }

  async findOne(id: string, user: User): Promise<Mission> {
    if (user.role === UserRole.ADMIN) {
      const mission = await this.missionRepository.findOne({
        where: { id },
        relations: ['user'],
      });

      if (!mission) {
        throw new NotFoundException('Mission not found');
      }

      return mission;
    }

    const assignment = await this.assignmentRepository.findOne({
      where: { missionId: id, userId: user.id },
    });

    if (assignment) {
      const mission = await this.missionRepository.findOne({
        where: { id },
      });

      if (!mission) {
        throw new NotFoundException('Mission not found');
      }

      return mission;
    }

    const mission = await this.missionRepository.findOne({
      where: { id, userId: user.id },
    });

    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    return mission;
  }

  async update(id: string, userId: string, updateMissionDto: UpdateMissionDto): Promise<Mission> {
    const mission = await this.missionRepository.findOne({
      where: { id },
    });

    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    Object.assign(mission, updateMissionDto);
    return this.missionRepository.save(mission);
  }

  async delete(id: string, userId: string): Promise<void> {
    const mission = await this.missionRepository.findOne({
      where: { id },
    });

    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    await this.missionRepository.remove(mission);
  }

  async assignUsers(missionId: string, userIds: string[], assignedBy: User): Promise<MissionAssignment[]> {
    if (assignedBy.role !== UserRole.ADMIN) {
      throw new NotFoundException('Only admins can assign users to missions');
    }
    const mission = await this.missionRepository.findOne({
      where: { id: missionId },
    });

    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    const existingAssignments = await this.assignmentRepository.find({
      where: { missionId },
    });

    const existingUserIds = existingAssignments.map(a => a.userId);
    const newUserIds = userIds.filter(id => !existingUserIds.includes(id));
    this.logger.log(`Existing assignments for mission `, userIds);

    const assignments = newUserIds.map(userId =>
      this.assignmentRepository.create({
        missionId,
        userId,
        assignedBy: assignedBy.id,
        notified: false,
      })
    );

    const updateMissionDto = new UpdateMissionDto();
    updateMissionDto.status = 'assignee';
    updateMissionDto.userId = userIds[0];
    await this.update(missionId, assignedBy.id, updateMissionDto);

    return this.assignmentRepository.save(assignments);
  }

  async getAssignedUsers(missionId: string): Promise<User[]> {
    const assignments = await this.assignmentRepository.find({
      where: { missionId },
      relations: ['user'],
    });

    return assignments.map(a => a.user);
  }

  async removeAssignment(missionId: string, userId: string): Promise<void> {
    const assignment = await this.assignmentRepository.findOne({
      where: { missionId, userId },
    });

    if (assignment) {
      await this.assignmentRepository.remove(assignment);
    }
  }

  async getAllUsers(): Promise<User[]> {
    const missions = await this.missionRepository.find({
      relations: ['user'],
    });

    const userMap = new Map<string, User>();
    missions.forEach(mission => {
      if (mission.user) {
        userMap.set(mission.user.id, mission.user);
      }
    });

    return Array.from(userMap.values());
  }
}
