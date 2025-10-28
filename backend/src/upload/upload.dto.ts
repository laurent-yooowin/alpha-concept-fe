import { IsNotEmpty, IsString } from "class-validator";

export class DeleteFileDto{
    @IsString()
    @IsNotEmpty()
    url: string;
}