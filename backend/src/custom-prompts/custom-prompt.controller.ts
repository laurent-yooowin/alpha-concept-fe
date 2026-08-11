import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../user/user.entity';
import { CreateCustomPromptDto, UpdateCustomPromptDto } from './custom-prompt.dto';
import { CustomPromptService } from './custom-prompt.service';

@Controller('custom-prompts')
@UseGuards(JwtAuthGuard)
export class CustomPromptController {
  constructor(private readonly service: CustomPromptService) {}

  @Get()
  findAvailable(@CurrentUser() user: User, @Query('missionType') missionType?: string) {
    return this.service.findAvailable(user, missionType);
  }

  @Get('admin')
  findAllForAdmin(@CurrentUser() user: User, @Query('missionType') missionType?: string) {
    return this.service.findAllForAdmin(user, missionType);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateCustomPromptDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateCustomPromptDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  async deactivate(@CurrentUser() user: User, @Param('id') id: string) {
    await this.service.deactivate(user, id);
    return { success: true };
  }
}
