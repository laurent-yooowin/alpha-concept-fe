import { Controller, Post, Body, UseGuards, Optional } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { IsString } from 'class-validator';

class AnalyzePhotoDto {
  @IsString()
  imageUrl: string;

  @Optional()
  @IsString()
  userComments?: string;
}

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Post('analyze-photo')
  async analyzePhoto(@Body() analyzePhotoDto: AnalyzePhotoDto) {
    return this.aiService.analyzePhoto(analyzePhotoDto.imageUrl, analyzePhotoDto.userComments);
  }
}
