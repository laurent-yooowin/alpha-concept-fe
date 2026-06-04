import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserService } from '../user/user.service';
import { User, UserRole } from '../user/user.entity';
import { RegisterDto } from './auth.dto';
import { MailService } from '../mail/mail.service';
import { Organization } from '../organizations/organization.entity';

export interface LoginDto {
  email: string;
  password: string;
  organizationSlug?: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface VerifyCodeDto {
  email: string;
  code: string;
}

export interface ResetPasswordDto {
  token: string;
  newPassword: string;
}

// In-memory OTP store (code -> { email, expiresAt })
const otpStore = new Map<string, { email: string; code: string; expiresAt: number }>();

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private mailService: MailService,
    @InjectRepository(Organization)
    private organizationRepository: Repository<Organization>,
  ) { }

  async login(loginDto: LoginDto) {
    const user = await this.userService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    const isPasswordValid = await this.userService.validatePassword(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (loginDto.organizationSlug) {
      const org = await this.organizationRepository.findOne({
        where: { slug: loginDto.organizationSlug },
      });
      if (!org || !org.isActive) {
        throw new UnauthorizedException('Organisation introuvable ou inactive');
      }
      if (
        user.role !== UserRole.HYPER_ADMIN &&
        user.organizationId !== org.id
      ) {
        throw new UnauthorizedException(
          "Vous n'appartenez pas à cette organisation",
        );
      }
    } else if (
      user.role !== UserRole.HYPER_ADMIN &&
      process.env.STRICT_LOGIN_PORTAL === 'true'
    ) {
      throw new UnauthorizedException(
        'Veuillez vous connecter via le portail de votre organisation',
      );
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.userService.findByEmail(registerDto.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const user = await this.userService.create(registerDto);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  async validateUser(userId: string): Promise<User> {
    return this.userService.findById(userId);
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.userService.findByEmail(forgotPasswordDto.email);

    // Always return success message to prevent email enumeration
    const successMessage = 'Si votre email est enregistré, vous recevrez un code de vérification.';

    if (!user) {
      return { message: successMessage };
    }

    // Generate 6-digit OTP code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store OTP keyed by email
    otpStore.set(forgotPasswordDto.email.toLowerCase(), { email: forgotPasswordDto.email, code, expiresAt });

    // Send email with code
    try {
      await this.mailService.sendOtpCode(forgotPasswordDto.email, code, user.firstName);
    } catch (error) {
      console.error('Failed to send OTP email:', error);
    }

    return { message: successMessage };
  }

  async verifyCode(verifyCodeDto: VerifyCodeDto) {
    const emailKey = verifyCodeDto.email.toLowerCase();
    const stored = otpStore.get(emailKey);

    if (!stored) {
      throw new BadRequestException('Code invalide ou expiré');
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(emailKey);
      throw new BadRequestException('Code expiré. Veuillez en demander un nouveau.');
    }

    if (stored.code !== verifyCodeDto.code) {
      throw new BadRequestException('Code invalide');
    }

    // Code is valid - generate a short-lived reset token
    const user = await this.userService.findByEmail(verifyCodeDto.email);
    if (!user) {
      throw new BadRequestException('Utilisateur introuvable');
    }

    const resetToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'password-reset' },
      { expiresIn: '15m' }
    );

    // Remove used OTP
    otpStore.delete(emailKey);

    return { resetToken, message: 'Code vérifié avec succès' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    try {
      const decoded = this.jwtService.verify(resetPasswordDto.token);

      if (decoded.type !== 'password-reset') {
        throw new UnauthorizedException('Invalid reset token');
      }

      await this.userService.update(decoded.sub, {
        password: resetPasswordDto.newPassword,
      });

      return { message: 'Mot de passe réinitialisé avec succès' };
    } catch (error) {
      throw new UnauthorizedException('Token invalide ou expiré');
    }
  }
}
