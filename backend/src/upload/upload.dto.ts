import { IsNotEmpty, IsString, IsBoolean, IsOptional } from "class-validator";

export class DeleteFileDto{
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
    isBase64?: boolean;
}