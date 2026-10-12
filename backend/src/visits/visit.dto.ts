import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsString, IsOptional, IsDateString, IsBoolean, IsArray, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';
import { ValidateNested } from 'class-validator';

export class CreateVisitDto {
  @IsString()
  missionId: string;

  @IsDateString()
  visitDate: string;

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
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  customPromptIds?: string[];

}

export class AnalysisGroupCreateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  requestId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(4096, { each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(8192, { each: true })
  imageReceipts?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  userDirectives?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  comment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  customPromptIds?: string[];
}

export class AnalysisGroupReanalyzeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  requestId: string;

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  userDirectives?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  customPromptIds?: string[];
}

export class AnalysisGroupClarifyDto extends AnalysisGroupReanalyzeDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(4096, { each: true })
  detailImageUrls: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(8192, { each: true })
  detailImageReceipts: string[];
}

export class AnalysisGroupReanalyzeAllDto extends AnalysisGroupReanalyzeDto {}

export class AnalysisGroupAttachDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(4096, { each: true })
  imageUrls: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(8192, { each: true })
  imageReceipts: string[];

  @IsOptional()
  @IsBoolean()
  isDetailPhoto?: boolean;

  @IsOptional()
  @IsBoolean()
  isReadabilityPhoto?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  detailContext?: string;
}

export class AnalysisGroupPatchDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  observations?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  recommendations?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  references?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  userDirectives?: string;
}

export class AnalysisGroupBulkEditItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  groupId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  observations?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  recommendations?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  references?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  comment?: string;
}

export class AnalysisGroupBulkEditDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AnalysisGroupBulkEditItemDto)
  groups: AnalysisGroupBulkEditItemDto[];
}
