import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';

class AnalyzePhotoDto {
  imageUrl: string;
}

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('analyze-photo')
  async analyzePhoto(@Body() analyzePhotoDto: AnalyzePhotoDto) {
    return this.aiService.analyzePhoto(analyzePhotoDto.imageUrl);
  }
}
