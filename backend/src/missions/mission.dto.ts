import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsDateString, IsEmail, IsEnum, IsBoolean, IsEmpty } from 'class-validator';

export enum MissionType {
  CSPS = "CSPS",
  AEU = "AEU",
  Divers = "Divers",
}

export enum MissionStatus {
  PLANIFIED = 'planifiee',
  ASSIGNED = 'assignee',
  IN_PROGRESS = 'en_cours',
  TERMINATED = 'terminee',
  VALIDATED = 'validee',
}

export class CreateMissionDto {
  @IsString()
  title: string;

  @IsString()
  client: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  refClient?: string;

  @IsString()
  address: string;

  @IsDateString()
  date: string;

  @IsString()
  time: string;

  @IsOptional()
  @Transform(({ value }) => value === null || value == '' ? undefined : value)
  @IsDateString()
  endDate?: string;

  @IsString()
  type: MissionType;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  description?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsEnum(MissionStatus)
  status?: MissionStatus;

  // @IsOptional()
  @IsString()
  contactFirstName?: string;

  // @IsOptional()
  @IsString()
  contactLastName?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  refBusiness?: string;

  // @IsOptional()
  @IsEmail()
  contactEmail?: string;

  // @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  userId?: string;
}

export class UpdateMissionDto {
  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  title?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  client?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  refClient?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  address?: string;

  @IsOptional()
  @Transform(({ value }) => value === null || value == '' ? undefined : value)
  @IsDateString()
  date?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  time?: string;

  @IsOptional()
  @Transform(({ value }) => value === null || value == '' ? undefined : value)
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  type?: MissionType;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  description?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsEnum(MissionStatus)
  status?: MissionStatus;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  contactFirstName?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  contactLastName?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  refBusiness?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  userId?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsBoolean()
  assigned?: boolean;
}
