import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CustomPromptService, ResolvedCustomPrompts } from '../custom-prompts/custom-prompt.service';
import { User } from '../user/user.entity';
import { AiPromptContext, AiService } from './ai.service';

class PromptSelectionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  customPromptIds?: string[];

  @IsOptional()
  @IsUUID('4')
  visitId?: string;

  @IsOptional()
  @IsString()
  missionType?: string;
}

class AnalyzePhotoDto extends PromptSelectionDto {
  @IsString()
  @IsNotEmpty()
  imageUrl: string;
}

class AnalyzePhotoDirectivesDto extends PromptSelectionDto {
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @IsString()
  @IsOptional()
  userDirectives?: string;

  @IsString()
  @IsOptional()
  previousReport?: string;
}

class AnalyzeDirectivesDto extends PromptSelectionDto {
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

class AnalyzeBatchPhotosDto extends PromptSelectionDto {
  @IsArray()
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

class AnalyzeBatchEnhancedDto extends PromptSelectionDto {
  @IsArray()
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
  constructor(
    private readonly aiService: AiService,
    private readonly customPromptService: CustomPromptService,
  ) {}

  private async resolvePromptContext(
    user: User,
    dto: PromptSelectionDto,
  ): Promise<{ context: AiPromptContext; resolved: ResolvedCustomPrompts }> {
    const resolved = await this.customPromptService.resolveForAnalysis(
      user,
      dto.customPromptIds,
      dto.visitId,
      dto.missionType,
    );
    return {
      resolved,
      context: {
        customPromptText: resolved.combinedContent,
        missionType: resolved.missionType,
      },
    };
  }

  private responseWithPromptMetadata(analysis: any, resolved: ResolvedCustomPrompts) {
    return {
      ...analysis,
      appliedCustomPrompts: resolved.prompts.map((prompt) => ({
        id: prompt.id,
        name: prompt.name,
        content: prompt.content,
      })),
    };
  }

  @Post('analyze-photo')
  async analyzePhoto(@CurrentUser() user: User, @Body() dto: AnalyzePhotoDto) {
    const { context, resolved } = await this.resolvePromptContext(user, dto);
    const analysis = await this.aiService.analyzePhoto(dto.imageUrl, context);
    return this.responseWithPromptMetadata(analysis, resolved);
  }

  @Post('analyze-photo-directives')
  async analyzePhotoWithDirectives(
    @CurrentUser() user: User,
    @Body() dto: AnalyzePhotoDirectivesDto,
  ) {
    const { context, resolved } = await this.resolvePromptContext(user, dto);
    const analysis = await this.aiService.analyzePhotoWithDirectives(
      dto.imageUrl,
      dto.userDirectives,
      dto.previousReport,
      context,
    );
    return this.responseWithPromptMetadata(analysis, resolved);
  }

  @Post('analyze-directives')
  async analyzeDirectives(@CurrentUser() user: User, @Body() dto: AnalyzeDirectivesDto) {
    const { context, resolved } = await this.resolvePromptContext(user, dto);
    const analysis = await this.aiService.analyzeDirectives(
      dto.userDirectives,
      dto.missionContext,
      dto.previousReport,
      context,
    );
    return this.responseWithPromptMetadata(analysis, resolved);
  }

  @Post('analyze-batch')
  async analyzeBatchPhotos(@CurrentUser() user: User, @Body() dto: AnalyzeBatchPhotosDto) {
    const { context, resolved } = await this.resolvePromptContext(user, dto);
    const analysis = await this.aiService.analyzeBatchPhotos(
      dto.imageUrls,
      dto.userDirectives,
      dto.previousReport,
      context,
    );
    return this.responseWithPromptMetadata(analysis, resolved);
  }

  @Post('analyze-batch-enhanced')
  async analyzeBatchEnhanced(@CurrentUser() user: User, @Body() dto: AnalyzeBatchEnhancedDto) {
    const { context, resolved } = await this.resolvePromptContext(user, dto);
    const analysis = await this.aiService.analyzeBatchEnhanced(
      dto.imageUrls,
      dto.previousAnalysis,
      dto.unreadableSections,
      dto.userDirectives,
      context,
    );
    return this.responseWithPromptMetadata(analysis, resolved);
  }
}
