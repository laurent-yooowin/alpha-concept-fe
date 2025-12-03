import { IsString, IsOptional, IsEnum, IsNumber, IsUUID, IsEmail, IsDate } from 'class-validator';
import { ReportStatus } from './report.entity';
import { Transform } from 'class-transformer';

export class CreateReportDto {
  @IsUUID()
  missionId: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsUUID()
  visitId?: string;

  @IsString()
  title: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  header?: string;

  @IsString()
  content: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  footer?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsNumber()
  conformityPercentage?: number;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  observations?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  remarquesAdmin?: string;

}

export class UpdateReportDto {
  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  title?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  header?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  content?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  footer?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  observations?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  remarquesAdmin?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsNumber()
  conformityPercentage?: number;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  reportFileUrl?: string;
  
  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsDate()
  sentToClientAt?: Date;
}
