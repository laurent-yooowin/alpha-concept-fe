import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional,
  IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const DECIMAL_4 = /^\d{1,14}(?:\.\d{1,4})?$/;
const DECIMAL_2 = /^\d{1,16}(?:\.\d{1,2})?$/;
const ZERO_RATE = /^0(?:\.0{1,2})?$/;
const decimalString = ({ value }: { value: unknown }) => value === null || value === undefined || value === '' ? value : String(value).trim();

export enum PreventionBudgetLineStatusDto {
  A_CHIFFRER = 'A_CHIFFRER', ESTIME = 'ESTIME', VALIDE = 'VALIDE', ENGAGE = 'ENGAGE', REALISE = 'REALISE',
}

export enum PreventionBudgetPriorityDto {
  LOW = 'LOW', MEDIUM = 'MEDIUM', HIGH = 'HIGH', URGENT = 'URGENT',
}

export class PreventionBudgetListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @Transform(trim) @IsEnum(['DRAFT', 'CALCULATED', 'VALIDATED', 'ARCHIVED']) status?: string;
}

export class PreventionBudgetSourceDto {
  @Transform(trim) @IsEnum(['RECOMMENDATION', 'FINDING', 'REPORT']) sourceKind: 'RECOMMENDATION' | 'FINDING' | 'REPORT';
  @IsOptional() @Transform(trim) @IsUUID('4') findingId?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') reportId?: string;
}

export class PreventionBudgetCreateDto {
  @IsOptional() @Transform(trim) @Matches(/^[A-Za-z0-9_.:-]{1,64}$/) scenarioKey?: string;
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  @Transform(decimalString) @Matches(ZERO_RATE) contingencyRatePercent: string;
  @IsOptional() @Transform(trim) @IsUUID('4') missionId?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') chantierId?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') categoryId?: string;
  @IsOptional() @Transform(trim) @IsIn(['faible', 'moyen', 'eleve', 'critique']) severity?: string;
}

export class PreventionBudgetScopeDto {
  @IsIn(['ALL', 'LAST_7_DAYS', 'LAST_30_DAYS', 'CURRENT_QUARTER', 'LAST_6_MONTHS', 'CURRENT_YEAR', 'LAST_12_MONTHS', 'CUSTOM']) preset: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') categoryId?: string;
  @IsOptional() @Transform(trim) @IsIn(['faible', 'moyen', 'eleve', 'critique']) severity?: string;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.split(',').filter(Boolean) : value)
  @IsArray() @ArrayMaxSize(50) @Matches(/^(?:[0-9a-f]{64}|unassigned)$/, { each: true }) clientKeys?: string[];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) adminPrompt?: string;
}

/** Explicitly separates a bounded current-year request from an unbounded run. */
export enum PreventionBudgetExecutionModeDto {
  CURRENT_YEAR = 'CURRENT_YEAR',
  FILTERED = 'FILTERED',
  GLOBAL_YEARLY = 'GLOBAL_YEARLY',
}

export class PreventionBudgetPreviewDto {
  @Transform(({ value, obj }) => value ?? obj?.calculationMode) @IsEnum(PreventionBudgetExecutionModeDto) mode: PreventionBudgetExecutionModeDto;
  @IsOptional() @Transform(trim) @IsEnum(PreventionBudgetExecutionModeDto) calculationMode?: PreventionBudgetExecutionModeDto;
  @IsOptional() @Transform(trim) @IsIn(['ALL', 'LAST_7_DAYS', 'LAST_30_DAYS', 'CURRENT_QUARTER', 'LAST_6_MONTHS', 'CURRENT_YEAR', 'LAST_12_MONTHS', 'CUSTOM']) preset?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') categoryId?: string;
  @IsOptional() @Transform(trim) @IsIn(['faible', 'moyen', 'eleve', 'critique']) severity?: string;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.split(',').filter(Boolean) : value)
  @IsArray() @ArrayMaxSize(50) @Matches(/^(?:[0-9a-f]{64}|unassigned)$/, { each: true }) clientKeys?: string[];
}

export class PreventionBudgetCommandDto extends PreventionBudgetPreviewDto {
  @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) @MaxLength(1024) confirmationToken: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) adminPrompt?: string;
}

export class PreventionBudgetClientFilterDto {
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.split(',').filter(Boolean) : value)
  @IsArray() @ArrayMaxSize(50) @Matches(/^(?:[0-9a-f]{64}|unassigned)$/, { each: true }) clientKeys?: string[];
}

export class PreventionBudgetPatchDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @Transform(decimalString) @Matches(ZERO_RATE) contingencyRatePercent?: string;
  @IsOptional() @Transform(trim) @IsEnum(['DRAFT', 'CALCULATED', 'VALIDATED', 'ARCHIVED']) status?: string;
}

export class PreventionBudgetItemPatchDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) title?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') categoryId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) categoryKey?: string;
  @IsOptional() @Transform(decimalString) @Matches(DECIMAL_4) quantity?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50) unit?: string;
  @IsOptional() @Transform(decimalString) @Matches(DECIMAL_2) unitCostHt?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) priceSource?: string | null;
  @IsOptional() @Transform(trim) @IsEnum(PreventionBudgetLineStatusDto) status?: PreventionBudgetLineStatusDto;
  @IsOptional() @Transform(trim) @IsEnum(PreventionBudgetPriorityDto) priority?: PreventionBudgetPriorityDto;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(10000) justification?: string | null;
  @IsOptional() @IsBoolean() lockedManual?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PreventionBudgetSourceDto)
  sources?: PreventionBudgetSourceDto[];
}

export class PreventionBudgetRecalculateDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) adminPrompt?: string;
}

export class PreventionBudgetItemRecalculateDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) adminPrompt?: string;
}

export class PreventionCostCatalogCreateDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(64) matchingKey?: string;
  @IsOptional() @Transform(trim) @IsUUID('4') categoryId?: string;
  @Transform(trim) @IsString() @MaxLength(80) categoryKey: string;
  @Transform(trim) @IsString() @MaxLength(255) label: string;
  @Transform(trim) @IsString() @MaxLength(50) unit: string;
  @Transform(decimalString) @Matches(DECIMAL_2) unitCostHt: string;
  @Transform(trim) @IsString() @MaxLength(500) priceSource: string;
  @IsDateString() validFrom: string;
  @IsOptional() @IsDateString() validTo?: string;
}

export class PreventionCostCatalogStatusDto {
  @IsBoolean() isActive: boolean;
}
