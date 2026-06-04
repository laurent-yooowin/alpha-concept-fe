import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateMailingListEntryDto {
  @IsUUID()
  missionId: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class UpdateMailingListEntryDto {
  @IsOptional()
  @IsUUID()
  missionId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class BulkMailingListEntryDto {
  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class BulkCreateMailingListDto {
  @IsUUID()
  missionId: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => BulkMailingListEntryDto)
  entries: BulkMailingListEntryDto[];
}
