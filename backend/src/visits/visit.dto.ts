import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsDateString, IsBoolean, IsNumber, IsArray, IsUUID } from 'class-validator';

export class CreateVisitDto {
  @IsString()
  missionId: string;

  @IsDateString()
  visitDate: string;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsArray()
  photos?: any[];

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsNumber()
  photoCount?: number;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  customPromptIds?: string[];
}

export class UpdateVisitDto {
  @IsOptional()
  @Transform(({ value }) => value === null || value == '' ? undefined : value)
  @IsDateString()
  visitDate?: string | Date;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsArray()
  photos?: any[];

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsNumber()
  photoCount?: number;

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  customPromptIds?: string[];

  @IsOptional()
  @Transform(({ value }) => value === null ? undefined : value)
  @IsBoolean()
  reportGenerated?: boolean;
}
