import { IsString, IsOptional, IsEnum, IsNumber, IsUUID, IsEmail } from 'class-validator';
import { ReportStatus } from './report.entity';

export class CreateReportDto {
  @IsUUID()
  missionId: string;

  @IsOptional()
  @IsUUID()
  visitId?: string;

  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @IsNumber()
  conformityPercentage?: number;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}

export class UpdateReportDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @IsNumber()
  conformityPercentage?: number;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}
