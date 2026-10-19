import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class PreventionRebuildScopeDto {
  @IsOptional() @IsUUID('4') missionId?: string;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.split(',').filter(Boolean) : value)
  @IsArray() @ArrayMaxSize(50) @Matches(/^(?:[0-9a-f]{64}|unassigned)$/, { each: true }) clientKeys?: string[];
}

/** Confirmation of a recent tenant-scoped reconstruction preview. */
export class PreventionRebuildConfirmDto extends PreventionRebuildScopeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  previewToken: string;
}
