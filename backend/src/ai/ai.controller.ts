import { Controller, Post, Body, UseGuards, Optional } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { IsNotEmpty, IsString, } from 'class-validator';

class AnalyzePhotoDto {
  @IsString()
  @IsNotEmpty()
  imageUrl: string;
}

class AnalyzePhotoDirectivesDto {
  @IsString()
  @IsNotEmpty()
  imageUrl: string;
  
  @IsString()
  @IsNotEmpty()
  userDirectives?: string;

  @IsString()
  @IsNotEmpty()
  previousReport?: string;
}

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Post('analyze-photo')
  async analyzePhoto(@Body() analyzePhotoDto: AnalyzePhotoDto) {
    return this.aiService.analyzePhoto(analyzePhotoDto.imageUrl);
  }

  @Post('analyze-photo-directives')
  async analyzePhotoWithDirectives(@Body() analyzePhotoDirectivesDto: AnalyzePhotoDirectivesDto) {
    return this.aiService.analyzePhotoWithDirectives(
      analyzePhotoDirectivesDto.imageUrl, 
      analyzePhotoDirectivesDto.userDirectives, 
      analyzePhotoDirectivesDto.previousReport
    );
  }
}
