import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateClientDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactFirstName?: string;
  @IsOptional() @IsString() contactLastName?: string;
  @IsOptional() @IsString() refClient?: string;
}

export class UpdateClientDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactFirstName?: string;
  @IsOptional() @IsString() contactLastName?: string;
  @IsOptional() @IsString() refClient?: string;
}
