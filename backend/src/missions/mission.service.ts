import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, forwardRef, Inject, HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { orgScope } from '../common/utils/org-scope';
import { Mission } from './mission.entity';
import { MissionAssignment } from './mission-assignment.entity';
import { CreateMissionDto, MissionStatus, UpdateMissionDto } from './mission.dto';
import { User, UserRole } from '../user/user.entity';
import { UserService } from '../user/user.service';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { Roles } from '../auth/decorators/roles.decorator';
import { VisitService } from '../visits/visit.service';
import { ReportService } from '../reports/report.service';
import { ReportStatus, isReportLocked } from '../reports/report.entity';

@Injectable()
export class MissionService {
  constructor(
    @InjectRepository(Mission)
    private missionRepository: Repository<Mission>,
    @InjectRepository(MissionAssignment)
    private assignmentRepository: Repository<MissionAssignment>,
    private userService: UserService,

    @Inject(forwardRef(() => VisitService))
    private visitService: VisitService,

    @Inject(forwardRef(() => ReportService))
    private reportService: ReportService,
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
      organizationId: user.organizationId,
    });
    return this.missionRepository.save(mission);
  }

  async findAll(user: User): Promise<Mission[]> {
    let missions;
    if (user.role === UserRole.ADMIN || user.role === UserRole.HYPER_ADMIN) {
      missions = await this.missionRepository.find({
        where: orgScope(user),
        relations: ['user'],
        order: { createdAt: 'DESC' },
      });
    } else {
      missions = await this.missionRepository.find({
        where: orgScope(user, { userId: user.id }),
        order: { createdAt: 'DESC' },
      });
    }

    if (missions) {
      await Promise.all(missions.map(async (mission) => {
        const missionId = mission.id;
        const userId = user.id;
        const assignment = await this.assignmentRepository.findOne({
          where: { missionId },
        });
        if (assignment) {
          mission.assigned = true;
        }
        const visits = await this.visitService.findByMission(mission.id, user);
        if (visits && visits.length > 0) {
          visits.sort((a, b) => b.visitDate.getTime() - a.visitDate.getTime());
          await Promise.all(visits.map(async (visit) => {
            let report = await this.reportService.findByVisit(visit.id, user);
            if (report) {
              report.content = null;
              report.header = null;
              report.footer = null;
              report.observations = null;
              report.remarquesAdmin = null;
              visit.photos = null;
              visit.notes = null;
              visit.report = report;
            }
            return visit;
          }));
          mission.visits = visits;
        }
        return mission;
      }));
    }

    return missions;

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
    let mission = new Mission();
    if (user.role === UserRole.ADMIN || user.role === UserRole.HYPER_ADMIN) {
      mission = await this.missionRepository.findOne({
        where: orgScope(user, { id }),
        relations: ['user'],
      });
    } else {
      mission = await this.missionRepository.findOne({
        where: orgScope(user, { id, userId: user.id }),
      });
    }

    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    const assignment = await this.assignmentRepository.findOne({
      where: { missionId: id, userId: user.id },
    });

    if (assignment) {
      mission.assigned = true;
    }

    const visits = await this.visitService.findByMission(mission.id, user);
    if (visits && visits.length > 0) {
      visits.sort((a, b) => b.visitDate.getTime() - a.visitDate.getTime());
      await Promise.all(visits.map(async (visit) => {
        let report = await this.reportService.findByVisit(visit.id, user);
        // report.content = null;
        // report.header = null;
        // report.footer = null;
        // report.observations = null;
        // report.remarquesAdmin = null;
        // visit.photos = null;
        // visit.notes = null;
        if (report) {
          visit.report = report;
        }
        return visit;
      }));
      mission.visits = visits;
    }

    return mission;
  }

  async update(id: string, user: User, updateMissionDto: UpdateMissionDto): Promise<Mission> {
    const mission = await this.missionRepository.findOne({ where: orgScope(user, { id }) });
    if (!mission) throw new NotFoundException('Mission not found');
    return this.missionRepository.manager.transaction(async (manager) => {
      const [lockedMission] = await manager.query(
        `SELECT id,title,client,address,type FROM missions WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
        [mission.organizationId, id],
      );
      if (!lockedMission) throw new NotFoundException('Mission not found');
      const pdfMetadataChanged = (['title', 'client', 'address', 'type'] as const).some(
        (field) => updateMissionDto[field] !== undefined && updateMissionDto[field] !== lockedMission[field],
      );
      Object.assign(mission, updateMissionDto);
      const saved = await manager.getRepository(Mission).save(mission);
      if (pdfMetadataChanged) {
        await manager.query(
          `SELECT id FROM visits WHERE organizationId=? AND missionId=? ORDER BY id FOR UPDATE`,
          [mission.organizationId, id],
        );
        await manager.query(
          `UPDATE reports r JOIN visits v ON v.id=r.visitId AND v.organizationId=?
           SET r.reportFileUrl=NULL WHERE v.missionId=?
             AND r.status NOT IN ('envoye_au_client','archive')`,
          [mission.organizationId, id],
        );
      }
      return saved;
    });
  }

  async delete(id: string, user: User): Promise<void> {
    const mission = await this.missionRepository.findOne({
      where: orgScope(user, { id }),
    });

    if (!mission) {
      throw new NotFoundException('Mission not found');
    }
    const missionId = mission.id;

    const assignment = await this.assignmentRepository.findOne({
      where: { missionId, userId: user.id },
    });

    if (assignment || mission.status == MissionStatus.TERMINATED) {
      const errorMsg = mission.status == MissionStatus.TERMINATED ? 'Mission terminée, impossible de la supprimer. ' : "La mission a été assignée impossible de la supprimer";
      throw new Error(errorMsg);
    } else {
      let deletedReportIds: string[] = [];
      await this.missionRepository.manager.transaction(async (manager) => {
        const [lockedMission] = await manager.query(
          `SELECT id FROM missions WHERE organizationId=? AND id=? LIMIT 1 FOR UPDATE`,
          [mission.organizationId, missionId],
        );
        if (!lockedMission) throw new NotFoundException('Mission not found');
        await manager.query(
          `SELECT id FROM visits WHERE organizationId=? AND missionId=? ORDER BY id FOR UPDATE`,
          [mission.organizationId, missionId],
        );
        const linkedReports: Array<{ id: string; status: ReportStatus }> = await manager.query(
          `SELECT r.id,r.status FROM reports r
           JOIN visits v ON v.id=r.visitId AND v.organizationId=?
           WHERE v.missionId=? FOR UPDATE`,
          [mission.organizationId, missionId],
        );
        if (linkedReports.some((report) => isReportLocked(report.status))) {
          throw new ConflictException('Ce chantier contient un rapport envoyé au client ou archivé');
        }
        for (const report of linkedReports) {
          await this.reportService.markReportDeletionPartitions(manager, mission.organizationId, report.id);
        }
        deletedReportIds = linkedReports.map((report) => report.id);
        await manager.getRepository(Mission).remove(mission);
      });
      for (const reportId of deletedReportIds) {
        this.reportService.notifyReportDeletedAfterCommit(mission.organizationId, reportId);
      }
    }
  }

  async assignUsers(missionId: string, userIds: string[], assignedBy: User): Promise<MissionAssignment[]> {
    if (assignedBy.role !== UserRole.ADMIN && assignedBy.role !== UserRole.HYPER_ADMIN) {
      throw new NotFoundException('Only admins can assign users to missions');
    }
    const mission = await this.missionRepository.findOne({
      where: orgScope(assignedBy, { id: missionId }),
    });

    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    // Ensure target users belong to the same organization (defense in depth)
    const targetUsers = await this.userService.findAll(assignedBy);
    const validIds = new Set(targetUsers.map(u => u.id));
    const safeUserIds = userIds.filter(id => validIds.has(id));
    if (safeUserIds.length !== userIds.length) {
      throw new NotFoundException("Un ou plusieurs coordonnateurs n'appartiennent pas à votre organisation");
    }

    const existingAssignments = await this.assignmentRepository.find({
      where: { missionId },
    });

    const existingUserIds = existingAssignments.map(a => a.userId);
    const newUserIds = safeUserIds.filter(id => !existingUserIds.includes(id));

    const assignments = newUserIds.map(userId =>
      this.assignmentRepository.create({
        missionId,
        userId,
        assignedBy: assignedBy.id,
        notified: false,
        organizationId: mission.organizationId,
      })
    );

    const updateMissionDto = new UpdateMissionDto();
    updateMissionDto.status = MissionStatus.ASSIGNED;
    updateMissionDto.assigned = true;
    updateMissionDto.userId = safeUserIds[0];
    this.logger.log('🚀 updateMissionDto.status =', updateMissionDto.status);
    await this.update(missionId, assignedBy, updateMissionDto);

    this.logger.log(`Existing assignments for mission `, safeUserIds);
    return this.assignmentRepository.save(assignments);
  }

  async getAssignedUsers(missionId: string, currentUser: User): Promise<User[]> {
    // Validate the mission belongs to the user's organization first
    const mission = await this.missionRepository.findOne({
      where: orgScope(currentUser, { id: missionId }),
    });
    if (!mission) {
      throw new NotFoundException('Mission not found');
    }
    const assignments = await this.assignmentRepository.find({
      where: { missionId },
      relations: ['user'],
    });

    return assignments.map(a => a.user);
  }

  async removeAssignment(missionId: string, userId: string, user: User): Promise<void> {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.HYPER_ADMIN) {
      throw new NotFoundException('Only admins can remove assignment of the mission');
    }

    const mission = await this.findOne(missionId, user);

    if (!mission) {
      throw new NotFoundException('Mission not found');
    }

    const assignment = await this.assignmentRepository.findOne({
      where: { missionId, userId },
    });

    if (assignment && mission.status != MissionStatus.TERMINATED) {
      await this.assignmentRepository.remove(assignment);
      mission.assigned = false;
      mission.status = mission.status == MissionStatus.ASSIGNED ? MissionStatus.PLANIFIED : mission.status;
    } else {
      const errorMsg = mission.status == MissionStatus.TERMINATED ? 'Mission terminée, impossible de supprimer son assignation. ' : "La mission n'a pas été assignée impossible de supprimer son assignation";
      throw new Error(errorMsg);
    }
  }

  async getAllUsers(currentUser: User): Promise<User[]> {
    const where: any = currentUser.role === UserRole.HYPER_ADMIN
      ? {}
      : { organizationId: currentUser.organizationId };

    const missions = await this.missionRepository.find({
      where,
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
      { key: "title", fileKey: "Nom de l'opération" },
      { key: "client", fileKey: "Maîtrise d'ouvrage" },
      { key: "address", fileKey: "Ville" },
      { key: "type", fileKey: "Nature des travaux" },
    ];

    const optionalColumns = [
      { key: "date", fileKey: "Date prévisionnelle début de réalisation" },
      { key: "time", fileKey: "temps" },
      { key: "endDate", fileKey: "Date prévisionnelle fin de réalisation" },
      { key: "refBusiness", fileKey: "Référence de l'affaire" },
      { key: "refClient", fileKey: "Référence client" },
      { key: "description", fileKey: "Description mission" },
      { key: "status", fileKey: "statut" },
      { key: "contactFirstName", fileKey: "Contact MOU" },
      { key: "contactLastName", fileKey: "" },
      { key: "contactEmail", fileKey: "Email client" },
      { key: "contactPhone", fileKey: "Téléphone client" },
      { key: "userEmail", fileKey: "Email coordonnateur" },
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
      col => !fileColumns.includes(col.fileKey.toLowerCase())
    );

    if (missingColumns.length > 0) {
      throw new BadRequestException(
        `Colonnes manquantes : ${missingColumns.map(col => col.fileKey).join(', ')}. Les colonne requises sont : ${requiredColumns.map(col => col.fileKey).join(', ')}`
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
          const filtredKeys = allColumns.filter(col => normalizedKey == col.fileKey.toLowerCase().trim());
          if (filtredKeys && filtredKeys.length > 0) {
            const filtredKey = filtredKeys[0].key;
            if (filtredKey == "contactFirstName" && row[key] && row[key].toString().trim() != "") {
              const vals = row[key].toString().trim().split(' ');
              const upperRegex = /^[A-Z]*$/;
              let contactFirstName = "";
              let contactLastName = "";
              vals.forEach(element => {
                if (element.match(upperRegex)) {
                  contactLastName = contactLastName + ' ' + element;
                } else {
                  contactFirstName = contactFirstName + ' ' + element;
                }
              });
              this.logger.log("contactFirstName >>> : " + contactFirstName);
              normalizedRow['contactFirstName'] = contactFirstName;
              normalizedRow['contactLastName'] = contactLastName;
            } else if (filtredKey == "address" && row[key] && row[key].toString().trim() != "") {
              const address = row[key] + ' ' + row['Code postal'];
              normalizedRow['address'] = address;
            } else if (filtredKey == "type" && row[key] && row[key].toString().trim() != "") {
              const val = row[key].toString().trim().toUpperCase();
              if (val != "CSPS" && val != "AEU" && val != "DIVERS") {
                normalizedRow[filtredKey] = "CSPS"
              }
            } else {
              normalizedRow[filtredKey] = row[key];
            }
          }
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
          contactFirstName: normalizedRow.contactFirstName || null,
          contactLastName: normalizedRow.contactLastName || null,
          contactEmail: normalizedRow.contactEmail?.toString().trim() || null,
          contactPhone: normalizedRow.contactPhone?.toString().trim() || null,
          userEmail: normalizedRow.userEmail?.toString().trim() || null,
          endDate: normalizedRow.endDate ? this.parseDate(normalizedRow.endDate) : null,
          refBusiness: normalizedRow.refBusiness?.toString().trim() || null,
          imported: true,
        };

        // this.logger.log("missionData >>>: " + JSON.stringify(missionData));

        let importUser: User = new User();
        importUser.id = null;

        if (missionData.userEmail) {
          importUser = await this.userService.findByEmail(missionData.userEmail);
          if (!importUser || (importUser.organizationId && importUser.organizationId !== user.organizationId)) {
            errors.push({
              row: rowNumber,
              error: `L'utilisateur avec email : ${missionData.userEmail} n'existe pas dans votre organisation. `,
              data: normalizedRow,
            });
            continue;
          } else {
            missionData.userId = importUser.id;
          }
        }

        if (!missionData.title || !missionData.client || !missionData.address) {
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
            organizationId: user.organizationId,
          },
        });

        if (existingMission && existingMission.status == MissionStatus.TERMINATED) {
          ignored.push({
            row: rowNumber,
            reason: `Mission < ${existingMission.title} > exist déjà et son statut est terminée`,
            data: normalizedRow,
          });
          continue;
        } else if (existingMission) {
          const updatedMission = await this.update(existingMission.id, importUser, missionData);
          imported.push(updatedMission);
          continue;
        }

        missionData.organizationId = user.organizationId;
        if (!missionData.userId) missionData.userId = user.id;
        const mission = this.missionRepository.create(missionData);
        const savedMission: any = await this.missionRepository.save(mission);
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
      // throw new Error('La valeur doit être une date');
      return null;
    }

    if (dateValue instanceof Date) {
      return dateValue;
    }

    if (typeof dateValue === 'number') {
      const date = XLSX.SSF.parse_date_code(dateValue);
      const retDate = new Date(date.y, date.m - 1, date.d);
      // this.logger.log("retDate >>> : " + retDate);
      return retDate;
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
