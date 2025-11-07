import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Mission } from './mission.entity';
import { MissionAssignment } from './mission-assignment.entity';
import { CreateMissionDto, MissionStatus, UpdateMissionDto } from './mission.dto';
import { User, UserRole } from '../user/user.entity';
import { UserService } from '../user/user.service';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

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

    return await this.missionRepository.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });

    // const assignments = await this.assignmentRepository.find({
    //   where: { userId: user.id },
    //   relations: ['mission'],
    // });

    // const assignedMissionIds = assignments.map(a => a.missionId);

    // if (assignedMissionIds.length > 0) {
    //   const assignedMissions = await this.missionRepository.find({
    //     where: { id: In(assignedMissionIds) },
    //     order: { createdAt: 'DESC' },
    //   });
    //   return [...userMissions, ...assignedMissions];
    // }

    // return userMissions;
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
    updateMissionDto.status = MissionStatus.ASSIGNED;
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

  async bulkImport(
    file: Express.Multer.File,
    user: User
  ): Promise<{
    imported: Mission[];
    ignored: Array<{ row: number; reason: string; data: any }>;
    errors: Array<{ row: number; error: string; data: any }>;
  }> {
    if (user.role !== UserRole.ADMIN) {
      throw new BadRequestException('Seul les Admins peuvent importer des missions');
    }

    const requiredColumns = [
      'title',
      'client',
      'address',
      'date',
      'time',
      'type',
    ];

    const optionalColumns = [
      'refClient',
      'description',
      'status',
      'contactFirstName',
      'contactLastName',
      'contactEmail',
      'contactPhone',
      'userEmail',
    ];

    const allColumns = [...requiredColumns, ...optionalColumns];

    let rows: any[] = [];

    try {
      if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
        rows = parse(file.buffer, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
      } else if (
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.originalname.endsWith('.xlsx') ||
        file.originalname.endsWith('.xls')
      ) {
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(sheet);
      } else {
        throw new BadRequestException('Fichier non conforme. Merci de charger un fichier CSV ou Excel .');
      }
    } catch (error) {
      this.logger.error('Error parsing file:', error);
      throw new BadRequestException('Impossible de lire le fichier : ' + error.message);
    }

    if (!rows || rows.length === 0) {
      throw new BadRequestException('Fichier vide ou corrompu');
    }

    const fileColumns = Object.keys(rows[0]).map(col => col.toLowerCase().trim());

    const missingColumns = requiredColumns.filter(
      col => !fileColumns.includes(col.toLowerCase())
    );

    if (missingColumns.length > 0) {
      throw new BadRequestException(
        `Colonnes manquantes : ${missingColumns.join(', ')}. Les colonne requises sont : ${requiredColumns.join(', ')}`
      );
    }

    const imported: Mission[] = [];
    const ignored: Array<{ row: number; reason: string; data: any }> = [];
    const errors: Array<{ row: number; error: string; data: any }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      try {
        const normalizedRow: any = {};
        Object.keys(row).forEach(key => {
          const normalizedKey = key.toLowerCase().trim();
          normalizedRow[normalizedKey] = row[key];
        });

        const missionData: any = {
          title: normalizedRow.title?.toString().trim(),
          client: normalizedRow.client?.toString().trim(),
          address: normalizedRow.address?.toString().trim(),
          date: this.parseDate(normalizedRow.date),
          time: normalizedRow.time?.toString().trim(),
          type: normalizedRow.type?.toString().trim() || 'CSPS',
          refClient: normalizedRow.refclient?.toString().trim() || null,
          description: normalizedRow.description?.toString().trim() || null,
          status: normalizedRow.status?.toString().trim() || 'planifiee',
          contactFirstName: normalizedRow.contactfirstname?.toString().trim() || null,
          contactLastName: normalizedRow.contactlastname?.toString().trim() || null,
          contactEmail: normalizedRow.contactemail?.toString().trim() || null,
          contactPhone: normalizedRow.contactphone?.toString().trim() || null,
          userEmail: normalizedRow.useremail?.toString().trim() || null,
          imported: true,
        };

        let importUser: User = new User();
        importUser.id = null;

        if (missionData.userEmail){
          importUser = await this.userService.findByEmail(missionData.userEmail);
          if(!importUser){
            errors.push({
              row: rowNumber,
              error: `L'utilisateur avec email : ${missionData.userEmail} n'existe pas dans la base, merci de le créer d'abord. `,
              data: normalizedRow,
            });
            continue;
          } else {
            missionData.userId = importUser.id;
          }
        }

        if (!missionData.title || !missionData.client || !missionData.address || !missionData.date || !missionData.time) {
          errors.push({
            row: rowNumber,
            error: 'Colonnes manquantes',
            data: normalizedRow,
          });
          continue;
        }

        const existingMission = await this.missionRepository.findOne({
          where: {
            title: missionData.title,
            client: missionData.client,
            date: missionData.date,
            address: missionData.address,
          },
        });

        if (existingMission && existingMission.status == MissionStatus.TERMINATED) {
          ignored.push({
            row: rowNumber,
            reason: `Mission < ${existingMission.title} > exist déjà et son statut est terminée`,
            data: normalizedRow,
          });
          continue;
        } else if (existingMission){
          const updatedMission = await this.update(existingMission.id, importUser.id, missionData);          
          imported.push(updatedMission);
          continue;
        }

        const mission = this.missionRepository.create(missionData);
        const savedMission = await this.missionRepository.save(mission);
        imported.push(savedMission);
      } catch (error) {
        this.logger.error(`Error processing row ${rowNumber}:`, error);
        errors.push({
          row: rowNumber,
          error: error.message || 'Unknown error',
          data: row,
        });
      }
    }

    return {
      imported,
      ignored,
      errors,
    };
  }

  private parseDate(dateValue: any): Date {
    if (!dateValue) {
      throw new Error('La valeur doit être une date');
    }

    if (dateValue instanceof Date) {
      return dateValue;
    }

    if (typeof dateValue === 'number') {
      const date = XLSX.SSF.parse_date_code(dateValue);
      return new Date(date.y, date.m - 1, date.d);
    }

    const dateStr = dateValue.toString().trim();
    const formats = [
      /^(\d{4})-(\d{2})-(\d{2})$/,
      /^(\d{2})\/(\d{2})\/(\d{4})$/,
      /^(\d{2})-(\d{2})-(\d{4})$/,
    ];

    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        if (format === formats[0]) {
          return new Date(match[1], parseInt(match[2]) - 1, match[3]);
        } else {
          return new Date(match[3], parseInt(match[2]) - 1, match[1]);
        }
      }
    }

    const parsedDate = new Date(dateStr);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }

    throw new Error(`Le format de la date invalide : ${dateStr}. le format attendu est : YYYY-MM-DD, DD/MM/YYYY, ou DD-MM-YYYY`);
  }
}
