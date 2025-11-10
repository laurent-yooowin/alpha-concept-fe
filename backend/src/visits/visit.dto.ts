import { IsString, IsOptional, IsDateString, IsBoolean, IsNumber, IsArray } from 'class-validator';

export class CreateVisitDto {
  @IsString()
  missionId: string;

  @IsDateString()
  visitDate: string;

  @IsOptional()
  @IsArray()
  photos?: any[];

  @IsOptional()
  @IsNumber()
  photoCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateVisitDto {
  @IsOptional()
  @IsDateString()
  visitDate?: string | Date;

  @IsOptional()
  @IsArray()
  photos?: any[];

  @IsOptional()
  @IsNumber()
  photoCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  reportGenerated?: boolean;
}
