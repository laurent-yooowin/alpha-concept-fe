import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../organizations/organization.entity';
import { UserRole } from '../../user/user.entity';
import { assertOrganizationAccess, pendingLegalValidation } from '../organization-access';

export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret || secret.length < 32 || secret === 'your-secret-key-change-in-production') {
    throw new Error('JWT_SECRET must contain at least 32 non-default characters');
  }
  return secret;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
    @InjectRepository(Organization)
    private organizationRepository: Repository<Organization>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(configService),
    });
  }

  async validate(payload: any) {
    const user = await this.authService.validateUser(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }
    const organization = user.role === UserRole.HYPER_ADMIN || !user.organizationId
      ? null
      : await this.organizationRepository.findOne({
          where: { id: user.organizationId },
          select: { id: true, isActive: true, legalValidationStatus: true },
        });
    const pending = assertOrganizationAccess(user, organization);
    if (pending) {
      Object.defineProperty(user, pendingLegalValidation, { value: true });
    }
    // Trust the DB-side organizationId rather than the token claim
    // to avoid stale tokens after admin re-assignment.
    return user;
  }
}
