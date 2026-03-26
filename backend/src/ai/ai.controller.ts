import { Controller, Post, Body, UseGuards, Optional } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { IsNotEmpty, IsOptional, IsString, } from 'class-validator';

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

class AnalyzeDirectivesDto {
  @IsString()
  @IsNotEmpty()
  userDirectives: string;

  @IsOptional()
  missionContext?: {
    title?: string;
    client?: string;
    address?: string;
    type?: string;
  };

  @IsString()
  @IsOptional()
  previousReport?: string;
}

class AnalyzeBatchPhotosDto {
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  imageUrls: string[];

  @IsString()
  @IsOptional()
  userDirectives?: string;

  @IsString()
  @IsOptional()
  previousReport?: string;
}

class AnalyzeBatchEnhancedDto {
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  imageUrls: string[];

  @IsOptional()
  previousAnalysis?: any;

  @IsOptional()
  unreadableSections?: string[];

  @IsString()
  @IsOptional()
  userDirectives?: string;
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

  @Post('analyze-directives')
  async analyzeDirectives(@Body() dto: AnalyzeDirectivesDto) {
    return this.aiService.analyzeDirectives(dto.userDirectives, dto.missionContext, dto.previousReport);
  }

  @Post('analyze-batch')
  async analyzeBatchPhotos(@Body() dto: AnalyzeBatchPhotosDto) {
    return this.aiService.analyzeBatchPhotos(dto.imageUrls, dto.userDirectives, dto.previousReport);
  }

  @Post('analyze-batch-enhanced')
  async analyzeBatchEnhanced(@Body() dto: AnalyzeBatchEnhancedDto) {
    return this.aiService.analyzeBatchEnhanced(
      dto.imageUrls,
      dto.previousAnalysis,
      dto.unreadableSections,
      dto.userDirectives,
    );
  }
}
