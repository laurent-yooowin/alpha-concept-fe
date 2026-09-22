import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { ReportStatus } from '../../reports/report.entity';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class PreventionQueryDto {
  @IsOptional() @IsIn(["LAST_7_DAYS", "LAST_30_DAYS", "CURRENT_QUARTER", "LAST_6_MONTHS", "CURRENT_YEAR", "LAST_12_MONTHS", "CUSTOM"]) preset?: "LAST_7_DAYS" | "LAST_30_DAYS" | "CURRENT_QUARTER" | "LAST_6_MONTHS" | "CURRENT_YEAR" | "LAST_12_MONTHS" | "CUSTOM";
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @Transform(trim) @IsIn(['CSPS', 'AEU', 'DIVERS']) missionType?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') missionId?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') chantierId?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') categoryId?: string;
  @IsOptional() @Transform(trim) @IsIn(['faible', 'moyen', 'eleve']) riskLevel?: string;
  @IsOptional() @Transform(trim) @IsEnum(ReportStatus) status?: ReportStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsIn(['businessDate', 'score', 'occurrenceCount', 'riskLevel', 'findingCount']) sortBy = 'businessDate';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder: 'asc' | 'desc' = 'desc';
}

export class PreventionReferenceQueryDto extends PreventionQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
