import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMinSize,
  MaxLength,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CustomPromptService, ResolvedCustomPrompts } from '../custom-prompts/custom-prompt.service';
import { User } from '../user/user.entity';
import { AiPromptContext, AiService } from './ai.service';
import { LlmQuotaService } from './llm-quota.service';
import { UploadedAssetService } from '../upload/uploaded-asset.service';
import { RequirePermission } from '../common/decorators/permissions.decorator';

const MAX_BATCH_PHOTOS = 20;

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
  @MaxLength(100)
  missionType?: string;
}

class MissionContextDto {
  @IsOptional() @IsString() @MaxLength(256) title?: string;
  @IsOptional() @IsString() @MaxLength(256) client?: string;
  @IsOptional() @IsString() @MaxLength(512) address?: string;
  @IsOptional() @IsString() @MaxLength(100) type?: string;
}

export function assertBoundedPreviousAnalysis(value: unknown): void {
  if (value === undefined) return;
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw new BadRequestException('Analyse précédente invalide'); }
  if (!serialized || serialized.length > 16_000) throw new BadRequestException('Analyse précédente trop volumineuse');
  const inspect = (node: unknown, depth: number): void => {
    if (depth > 6) throw new BadRequestException('Analyse précédente trop profonde');
    if (typeof node === 'string' && node.length > 4_096) throw new BadRequestException('Analyse précédente trop volumineuse');
    if (Array.isArray(node)) {
      if (node.length > 50) throw new BadRequestException('Analyse précédente trop volumineuse');
      node.forEach((entry) => inspect(entry, depth + 1));
    } else if (node && typeof node === 'object') {
      const entries = Object.entries(node);
      if (entries.length > 50) throw new BadRequestException('Analyse précédente trop volumineuse');
      entries.forEach(([key, entry]) => {
        if (key.length > 100) throw new BadRequestException('Analyse précédente invalide');
        inspect(entry, depth + 1);
      });
    }
  };
  inspect(value, 0);
}

class AnalyzePhotoDto extends PromptSelectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  imageUrl: string;
}

class AnalyzePhotoDirectivesDto extends PromptSelectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  imageUrl: string;

  @IsString()
  @IsOptional()
  @MaxLength(8_000)
  userDirectives?: string;

  @IsString()
  @IsOptional()
  @MaxLength(12_000)
  previousReport?: string;
}

class AnalyzeDirectivesDto extends PromptSelectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8_000)
  userDirectives: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MissionContextDto)
  missionContext?: MissionContextDto;

  @IsString()
  @IsOptional()
  @MaxLength(12_000)
  previousReport?: string;
}

class AnalyzeBatchPhotosDto extends PromptSelectionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_PHOTOS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(4096, { each: true })
  imageUrls: string[];

  @IsString()
  @IsOptional()
  @MaxLength(8_000)
  userDirectives?: string;

  @IsString()
  @IsOptional()
  @MaxLength(12_000)
  previousReport?: string;
}

export class AnalyzeBatchEnhancedDto extends PromptSelectionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_PHOTOS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(4096, { each: true })
  imageUrls: string[];

  @IsOptional()
  @IsObject()
  previousAnalysis?: any;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_PHOTOS)
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  unreadableSections?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(8_000)
  userDirectives?: string;
}

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly customPromptService: CustomPromptService,
    private readonly llmQuota: LlmQuotaService,
    private readonly assets: UploadedAssetService,
  ) {}

  private async assertImageAccess(user: User, imageUrl: string, visitId?: string): Promise<void> {
    await this.assets.assertAiAccess(user, imageUrl, { visitId });
  }

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
  @RequirePermission('visits', 'write')
  async analyzePhoto(@CurrentUser() user: User, @Body() dto: AnalyzePhotoDto) {
    await this.assertImageAccess(user, dto.imageUrl, dto.visitId);
    await this.llmQuota.reserve(user, 'analyze-photo');
    const { context, resolved } = await this.resolvePromptContext(user, dto);
    const analysis = await this.aiService.analyzePhoto(dto.imageUrl, context);
    return this.responseWithPromptMetadata(analysis, resolved);
  }

  @Post('analyze-photo-directives')
  @RequirePermission('visits', 'write')
  async analyzePhotoWithDirectives(
    @CurrentUser() user: User,
    @Body() dto: AnalyzePhotoDirectivesDto,
  ) {
    await this.assertImageAccess(user, dto.imageUrl, dto.visitId);
    await this.llmQuota.reserve(user, 'analyze-photo-directives');
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
  @RequirePermission('visits', 'write')
  async analyzeDirectives(@CurrentUser() user: User, @Body() dto: AnalyzeDirectivesDto) {
    await this.llmQuota.reserve(user, 'analyze-directives');
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
  @RequirePermission('visits', 'write')
  async analyzeBatchPhotos(@CurrentUser() user: User, @Body() dto: AnalyzeBatchPhotosDto) {
    for (const imageUrl of dto.imageUrls) await this.assertImageAccess(user, imageUrl, dto.visitId);
    await this.llmQuota.reserve(user, 'analyze-batch', dto.imageUrls.length);
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
  @RequirePermission('visits', 'write')
  async analyzeBatchEnhanced(@CurrentUser() user: User, @Body() dto: AnalyzeBatchEnhancedDto) {
    assertBoundedPreviousAnalysis(dto.previousAnalysis);
    for (const imageUrl of dto.imageUrls) await this.assertImageAccess(user, imageUrl, dto.visitId);
    await this.llmQuota.reserve(user, 'analyze-batch-enhanced', dto.imageUrls.length);
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
