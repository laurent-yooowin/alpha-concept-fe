import { BadRequestException, Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../organizations/organization.entity';
import { User, UserRole } from '../user/user.entity';
import { Mission } from '../missions/mission.entity';
import { Visit } from '../visits/visit.entity';
import { Report } from '../reports/report.entity';
import { Client } from '../clients/client.entity';
import { UserService } from '../user/user.service';

export interface CreateOrgUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  organizationId?: string | null;
  phone?: string;
  company?: string;
  isActive?: boolean;
}

export interface UpdateOrgUserDto {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  phone?: string;
  company?: string;
  isActive?: boolean;
  organizationId?: string | null;
}

@Injectable()
export class HyperAdminService {
  constructor(
    @InjectRepository(Organization) private orgRepo: Repository<Organization>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Mission) private missionRepo: Repository<Mission>,
    @InjectRepository(Visit) private visitRepo: Repository<Visit>,
    @InjectRepository(Report) private reportRepo: Repository<Report>,
    @InjectRepository(Client) private clientRepo: Repository<Client>,
    private readonly userService: UserService,
  ) {}

  async globalDashboard() {
    const orgs = await this.orgRepo.find({ order: { createdAt: 'DESC' } });

    const groupCounts = async (
      repo: Repository<any>,
      orgId: string,
      column = 'status',
    ): Promise<Record<string, number>> => {
      const rows = await repo
        .createQueryBuilder('e')
        .select(`e.${column}`, 'key')
        .addSelect('COUNT(*)', 'count')
        .where('e.organizationId = :orgId', { orgId })
        .groupBy(`e.${column}`)
        .getRawMany();
      const out: Record<string, number> = {};
      for (const r of rows) out[r.key ?? 'unknown'] = parseInt(r.count, 10);
      return out;
    };

    const perOrg = await Promise.all(
      orgs.map(async (org) => {
        const [
          admins,
          coordinators,
          missions,
          visits,
          reports,
          clients,
          missionStatuses,
          reportStatuses,
        ] = await Promise.all([
          this.userRepo.count({ where: { organizationId: org.id, role: UserRole.ADMIN } }),
          this.userRepo.count({ where: { organizationId: org.id, role: UserRole.USER } }),
          this.missionRepo.count({ where: { organizationId: org.id } }),
          this.visitRepo.count({ where: { organizationId: org.id } }),
          this.reportRepo.count({ where: { organizationId: org.id } }),
          this.clientRepo.count({ where: { organizationId: org.id } }),
          groupCounts(this.missionRepo, org.id, 'status'),
          groupCounts(this.reportRepo, org.id, 'status'),
        ]);
        return {
          organization: org,
          admins,
          coordinators,
          missions,
          visits,
          reports,
          clients,
          missionStatuses,
          reportStatuses,
        };
      }),
    );

    return {
      totals: {
        organizations: orgs.length,
        users: await this.userRepo.count(),
        missions: await this.missionRepo.count(),
        visits: await this.visitRepo.count(),
        reports: await this.reportRepo.count(),
        clients: await this.clientRepo.count(),
      },
      perOrganization: perOrg,
    };
  }

  allUsers() {
    return this.userRepo.find({
      select: ['id', 'email', 'firstName', 'lastName', 'role', 'phone', 'company', 'organizationId', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
  }

  async listOrgUsers(orgId: string) {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation introuvable');
    return this.userRepo.find({
      where: { organizationId: orgId },
      select: ['id', 'email', 'firstName', 'lastName', 'role', 'phone', 'company', 'isActive', 'organizationId', 'createdAt'],
      order: { role: 'ASC', createdAt: 'DESC' },
    });
  }

  async createUser(dto: CreateOrgUserDto) {
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Email et mot de passe requis');
    }
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email déjà utilisé');

    let organizationId: string | null = null;
    if (dto.role !== UserRole.HYPER_ADMIN) {
      if (!dto.organizationId) {
        throw new BadRequestException('Organisation requise pour un Admin ou un Coordonnateur');
      }
      const org = await this.orgRepo.findOne({ where: { id: dto.organizationId } });
      if (!org) throw new NotFoundException('Organisation introuvable');
      organizationId = org.id;
    }

    return this.userService.create({
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      phone: dto.phone,
      company: dto.company,
      isActive: dto.isActive ?? true,
      organizationId,
    } as any);
  }

  async createOrgUser(orgId: string, dto: CreateOrgUserDto) {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation introuvable');
    if (dto.role === UserRole.HYPER_ADMIN) {
      throw new ForbiddenException("Impossible de créer un HYPER_ADMIN attaché à une organisation");
    }
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Email et mot de passe requis');
    }
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email déjà utilisé');

    return this.userService.create({
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      phone: dto.phone,
      company: dto.company,
      isActive: dto.isActive ?? true,
      organizationId: orgId,
    } as any);
  }

  async updateUser(id: string, dto: UpdateOrgUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (dto.email && dto.email !== user.email) {
      const exists = await this.userRepo.findOne({ where: { email: dto.email } });
      if (exists) throw new ConflictException('Email déjà utilisé');
    }
    if (dto.role === UserRole.HYPER_ADMIN) {
      dto.organizationId = null;
    } else if (dto.role === UserRole.ADMIN || dto.role === UserRole.USER) {
      const nextOrgId = dto.organizationId ?? user.organizationId;
      if (!nextOrgId) {
        throw new BadRequestException('Organisation requise pour un Admin ou un Coordonnateur');
      }
      const org = await this.orgRepo.findOne({ where: { id: nextOrgId } });
      if (!org) throw new NotFoundException('Organisation introuvable');
      dto.organizationId = nextOrgId;
    }
    return this.userService.update(id, dto as any);
  }

  async deleteUser(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.role === UserRole.HYPER_ADMIN) {
      throw new ForbiddenException("Impossible de supprimer un HYPER_ADMIN ici");
    }
    await this.userRepo.remove(user);
    return { success: true };
  }
}
