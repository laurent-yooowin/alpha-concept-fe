import { IsString, MaxLength, MinLength } from 'class-validator';

/** Confirmation of a recent tenant-scoped reconstruction preview. */
export class PreventionRebuildConfirmDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  previewToken: string;
}
