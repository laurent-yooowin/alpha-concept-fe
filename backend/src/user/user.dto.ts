import {
  IsEmail,
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsInt,
  Min,
  IsBoolean,
  IsEnum,
  ValidateIf,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum UserRole {
  ADMIN = 'ROLE_ADMIN',
  USER = 'ROLE_USER',
  HYPER_ADMIN = 'ROLE_HYPER_ADMIN',
}

export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: 'Le mot de passe doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le mot de passe est requis' })
  @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
  @MaxLength(16, { message: 'Le mot de passe ne peut pas dépasser 16 caractères' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!_.\-]{6,16}$/,
    {
      message: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre. Caractères spéciaux autorisés: ! _ - .',
    }
  )
  password: string;

  @IsOptional() @IsString() firstName: string;
  @IsOptional() @IsString() lastName: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() company?: string;

  @IsOptional()
  @ValidateIf((o) => o.experience !== undefined && o.experience !== null && o.experience !== '')
  @IsInt({ message: 'L\'expérience doit être un nombre entier valide' })
  @Min(0, { message: 'L\'expérience doit être positive ou nulle' })
  experience?: number;

  @IsOptional()
  @IsEnum(UserRole, {
    message: 'Le rôle doit être ROLE_ADMIN, ROLE_USER ou ROLE_HYPER_ADMIN'
  })
  role?: UserRole;

  @IsOptional()
  @ValidateIf((o) => o.isActive !== undefined && o.isActive !== null && o.isActive !== '')
  @Type(() => Boolean)
  @IsBoolean({ message: 'isActive doit être un booléen (true/false)' })
  isActive?: boolean;

  /**
   * organizationId est ignoré sauf pour HYPER_ADMIN (filtré côté contrôleur).
   * On le garde dans le DTO pour permettre les déplacements explicites par hyper-admin.
   */
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
