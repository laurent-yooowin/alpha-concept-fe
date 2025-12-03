import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, IsBoolean, IsOptional } from "class-validator";

export class DeleteFileDto {
    @IsString()
    @IsNotEmpty()
    url: string;
}

export class DownloadFileDto {
    @IsString()
    @IsNotEmpty()
    publicUrl: string;

    @IsString()
    @IsNotEmpty()
    folder: string;

    @IsBoolean()
    @IsOptional()
    @Transform(({ value }) => value === null ? undefined : value)
    isBase64?: boolean;
}