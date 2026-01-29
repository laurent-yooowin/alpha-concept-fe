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
} from 'class-validator';
import { Type } from 'class-transformer';

export enum UserRole {
  ADMIN = 'ROLE_ADMIN',
  USER = 'ROLE_USER',
}

export class RegisterDto {
  @IsEmail({}, { message: 'Email invalide' })
  @IsNotEmpty({ message: 'L\'email est requis' })
  email: string;

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

  @IsString()
  @IsNotEmpty({ message: 'Le prénom est requis' })
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Le nom est requis' })
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  company?: string;

  // Validation uniquement si la valeur existe et n'est pas undefined
  @ValidateIf((o) => o.experience !== undefined && o.experience !== null && o.experience !== '')
  @Type(() => Number)
  @IsInt({ message: 'L\'expérience doit être un nombre entier valide' })
  @Min(0, { message: 'L\'expérience doit être positive ou nulle' })
  experience?: number;

  @IsOptional()
  @IsEnum(UserRole, {
    message: 'Le rôle doit être ROLE_ADMIN ou ROLE_USER'
  })
  role?: UserRole;

  @ValidateIf((o) => o.isActive !== undefined && o.isActive !== null && o.isActive !== '')
  @Type(() => Boolean)
  @IsBoolean({ message: 'isActive doit être un booléen (true/false)' })
  isActive?: boolean;
}
