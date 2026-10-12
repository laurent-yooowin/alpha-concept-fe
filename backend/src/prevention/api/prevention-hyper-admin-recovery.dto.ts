import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class PreventionHyperAdminRecoveryConfirmDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  confirmationToken: string;

  @IsBoolean()
  immediateRequested = false;
}
