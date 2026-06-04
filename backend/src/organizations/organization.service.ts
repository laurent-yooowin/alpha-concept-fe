import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from './organization.entity';
import {
  CreateOrganizationDto,
  ValidateLegalDocumentsDto,
  UpdateOrganizationDto,
} from './organization.dto';
import { UserService } from '../user/user.service';
import { User, UserRole } from '../user/user.entity';
import { UploadService } from '../upload/upload.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    private readonly userService: UserService,
    private readonly uploadService: UploadService,
    private readonly mailService: MailService,
  ) {}

  private portalUrl(slug: string) {
    const baseUrl = (
      process.env.FRONTEND_URL ||
      process.env.APP_URL ||
      'http://localhost:5173'
    ).replace(/\/+$/, '');
    return `${baseUrl}/${slug}/login?legalValidation=1`;
  }

  private async sendValidationRequestEmail(
    org: Organization,
    adminEmail?: string | null,
    temporaryPassword?: string,
  ) {
    if (!adminEmail) return;
    try {
      await this.mailService.sendLegalValidationRequest({
        to: adminEmail,
        organizationName: org.name,
        loginUrl: this.portalUrl(org.slug),
        adminEmail,
        temporaryPassword,
        cguContent: org.cguContent,
        privacyContent: org.privacyContent,
      });
    } catch (error) {
      this.logger.error(`Échec envoi email validation légale org ${org.id}`, error);
    }
  }

  private defaultCgu(dto: CreateOrganizationDto) {
    const adminName = [dto.adminFirstName, dto.adminLastName].filter(Boolean).join(' ') || 'Administrateur';
    return `**Organisation :** ${dto.name}
**Administrateur :** ${adminName}
**Email administrateur :** ${dto.adminEmail || dto.contactEmail || ''}

## 1. Objet
Les présentes CGU définissent les conditions d'utilisation du portail ${dto.name}.

## 2. Accès au service
L'accès au portail est réservé aux utilisateurs autorisés par ${dto.name}.

## 3. Utilisation
L'utilisateur s'engage à utiliser le service conformément à la réglementation applicable et aux règles internes de ${dto.name}.

## 4. Contact
${dto.contactEmail || dto.adminEmail || ''}`;
  }

  private defaultPrivacy(dto: CreateOrganizationDto) {
    const adminName = [dto.adminFirstName, dto.adminLastName].filter(Boolean).join(' ') || 'Administrateur';
    return `**Organisation :** ${dto.name}
**Administrateur :** ${adminName}
**Email administrateur :** ${dto.adminEmail || dto.contactEmail || ''}

## 1. Objet
Cette politique décrit la gestion des données personnelles dans le portail ${dto.name}.

## 2. Données collectées
- Données de compte
- Données de chantier
- Photos, notes et rapports

## 3. Droits
Les utilisateurs peuvent contacter ${dto.contactEmail || dto.adminEmail || ''} pour exercer leurs droits.

## 4. Contact
${dto.contactEmail || dto.adminEmail || ''}`;
  }

  async create(dto: CreateOrganizationDto, requestedBy?: User): Promise<Organization> {
    const existing = await this.orgRepo.findOne({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Slug '${dto.slug}' déjà utilisé`);
    }

    const cguContent = dto.cguContent === undefined ? this.defaultCgu(dto) : dto.cguContent || null;
    const privacyContent = dto.privacyContent === undefined ? this.defaultPrivacy(dto) : dto.privacyContent || null;
    const org = this.orgRepo.create({
      name: dto.name,
      slug: dto.slug,
      primaryColor: dto.primaryColor ?? null,
      secondaryColor: dto.secondaryColor ?? null,
      cguContent,
      privacyContent,
      loginTitle: dto.loginTitle ?? null,
      loginContent: dto.loginContent ?? null,
      contactEmail: dto.contactEmail ?? null,
      legalValidationStatus: 'en_cours',
      legalValidationRequestedAt: new Date(),
      legalValidationValidatedAt: null,
      legalValidationRequestedByEmail: requestedBy?.email ?? null,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.orgRepo.save(org);

    // Optionally create the admin user attached to this org
    let adminEmail = dto.adminEmail || dto.contactEmail || null;
    if (dto.adminEmail && dto.adminPassword) {
      const admin = await this.userService.create({
        email: dto.adminEmail,
        password: dto.adminPassword,
        firstName: dto.adminFirstName || dto.name,
        lastName: dto.adminLastName || 'Admin',
        role: UserRole.ADMIN,
        organizationId: saved.id,
        isActive: true,
      } as any);
      adminEmail = admin.email;
    }

    await this.sendValidationRequestEmail(saved, adminEmail, dto.adminPassword);

    return saved;
  }

  findAll(): Promise<Organization[]> {
    return this.orgRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException('Organization introuvable');
    return org;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return this.orgRepo.findOne({ where: { slug } });
  }

  async getReportBtpLegalDocs() {
    const rows = await this.orgRepo.manager.query(
      'SELECT `key`, `value` FROM `app_settings` WHERE `key` IN (?, ?)',
      ['reportbtp.cguContent', 'reportbtp.privacyContent'],
    );
    const values = new Map<string, string | null>(
      rows.map((row: { key: string; value: string | null }) => [row.key, row.value]),
    );
    return {
      cguContent: values.get('reportbtp.cguContent') || null,
      privacyContent: values.get('reportbtp.privacyContent') || null,
    };
  }

  async updateReportBtpLegalDocs(dto: { cguContent?: string; privacyContent?: string }) {
    const updates: Array<[string, string | null]> = [];
    if (Object.prototype.hasOwnProperty.call(dto, 'cguContent')) {
      updates.push(['reportbtp.cguContent', dto.cguContent ?? null]);
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'privacyContent')) {
      updates.push(['reportbtp.privacyContent', dto.privacyContent ?? null]);
    }

    for (const [key, value] of updates) {
      await this.orgRepo.manager.query(
        'INSERT INTO `app_settings` (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        [key, value],
      );
    }

    return this.getReportBtpLegalDocs();
  }

  async update(id: string, dto: UpdateOrganizationDto, requestedBy?: User): Promise<Organization> {
    const org = await this.findOne(id);

    if (dto.slug && dto.slug !== org.slug) {
      const exists = await this.orgRepo.findOne({ where: { slug: dto.slug } });
      if (exists) throw new ConflictException(`Slug '${dto.slug}' déjà utilisé`);
    }

    const legalContentChanged =
      Object.prototype.hasOwnProperty.call(dto, 'cguContent') ||
      Object.prototype.hasOwnProperty.call(dto, 'privacyContent');

    if (
      legalContentChanged &&
      requestedBy?.role === UserRole.HYPER_ADMIN &&
      org.legalValidationStatus === 'termine'
    ) {
      throw new ForbiddenException(
        "Les CGU et la politique de confidentialité validées ne peuvent être modifiées que par l'administrateur de l'organisation",
      );
    }

    Object.assign(org, dto);

    if (legalContentChanged) {
      if (requestedBy?.role === UserRole.ADMIN) {
        org.legalValidationStatus = 'termine';
        org.legalValidationValidatedAt = new Date();
      } else {
        org.legalValidationStatus = dto.legalValidationStatus || 'en_cours';
        org.legalValidationRequestedAt = new Date();
        org.legalValidationValidatedAt = null;
        org.legalValidationRequestedByEmail = requestedBy?.email ?? org.legalValidationRequestedByEmail;
      }
    }

    const saved = await this.orgRepo.save(org);

    if (legalContentChanged && saved.legalValidationStatus === 'en_cours') {
      const admin = await this.userService
        .findAll({ role: UserRole.HYPER_ADMIN } as User, saved.id)
        .then((users) => users.find((u) => u.role === UserRole.ADMIN))
        .catch(() => null);
      await this.sendValidationRequestEmail(saved, admin?.email || saved.contactEmail, undefined);
    }

    return saved;
  }

  async validateLegalDocuments(
    organizationId: string,
    user: User,
    dto: ValidateLegalDocumentsDto,
  ): Promise<Organization> {
    if (user.role !== UserRole.ADMIN || user.organizationId !== organizationId) {
      throw new BadRequestException('Validation réservée à l’administrateur de l’organisation');
    }
    if (!dto.cguContent?.trim() || !dto.privacyContent?.trim()) {
      throw new BadRequestException('Les CGU et la politique de confidentialité sont obligatoires');
    }

    const org = await this.findOne(organizationId);
    org.cguContent = dto.cguContent;
    org.privacyContent = dto.privacyContent;
    org.legalValidationStatus = 'termine';
    org.legalValidationValidatedAt = new Date();

    const saved = await this.orgRepo.save(org);
    const hyperAdminEmail = org.legalValidationRequestedByEmail || process.env.HYPER_ADMIN_EMAIL || '';

    try {
      await this.mailService.sendLegalValidationConfirmation({
        to: [user.email, hyperAdminEmail],
        organizationName: saved.name,
        cguContent: saved.cguContent || '',
        privacyContent: saved.privacyContent || '',
      });
    } catch (error) {
      this.logger.error(`Échec envoi confirmation validation légale org ${org.id}`, error);
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const org = await this.findOne(id);
    await this.orgRepo.remove(org);
  }

  async setLogo(id: string, file: Express.Multer.File): Promise<Organization> {
    if (!file) throw new BadRequestException('Aucun fichier fourni');
    const org = await this.findOne(id);

    const prefix = process.env.AWS_S3_LOGOS_PREFIX || 'organizations/logos/';
    const folder = `${prefix}${id}`.replace(/\/+$/, '');

    const uploaded = await this.uploadService.uploadFile(file, folder, {
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/jpg',
        'image/webp',
        'image/avif',
        'image/svg+xml',
      ],
      acceptedFormatsLabel: 'logos (JPEG, PNG, WebP, AVIF, SVG)',
    });
    org.logoS3Key = uploaded.key;
    return this.orgRepo.save(org);
  }

  async setBackgroundImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<Organization> {
    if (!file) throw new BadRequestException('Aucun fichier fourni');
    const org = await this.findOne(id);

    const prefix =
      process.env.AWS_S3_BACKGROUNDS_PREFIX || 'organizations/backgrounds/';
    const folder = `${prefix}${id}`.replace(/\/+$/, '');

    const uploaded = await this.uploadService.uploadFile(file, folder);
    org.backgroundImageS3Key = uploaded.key;
    return this.orgRepo.save(org);
  }

  async getLogoUrl(org: Organization): Promise<string | null> {
    if (!org.logoS3Key) return null;
    try {
      return await this.uploadService.getSignedUrl(org.logoS3Key, 3600);
    } catch {
      return null;
    }
  }

  async getBackgroundImageUrl(org: Organization): Promise<string | null> {
    if (!org.backgroundImageS3Key) return null;
    try {
      return await this.uploadService.getSignedUrl(
        org.backgroundImageS3Key,
        3600,
      );
    } catch {
      return null;
    }
  }
}
