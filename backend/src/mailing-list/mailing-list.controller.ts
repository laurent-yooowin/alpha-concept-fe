import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../user/user.entity';
import { MailingListService } from './mailing-list.service';
import {
  BulkCreateMailingListDto,
  CreateMailingListEntryDto,
  UpdateMailingListEntryDto,
} from './mailing-list.dto';

@Controller('mailing-list')
@UseGuards(JwtAuthGuard)
export class MailingListController {
  constructor(private readonly service: MailingListService) {}

  @Get()
  findAll(@CurrentUser() user: User) {
    return this.service.findAll(user);
  }

  @Get('missions')
  findMissionOptions(@CurrentUser() user: User) {
    return this.service.findMissionOptions(user);
  }

  @Get('mission/:missionId')
  findByMission(@CurrentUser() user: User, @Param('missionId') missionId: string) {
    return this.service.findByMission(user, missionId);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateMailingListEntryDto) {
    return this.service.create(user, dto);
  }

  @Post('bulk')
  bulk(@CurrentUser() user: User, @Body() dto: BulkCreateMailingListDto) {
    return this.service.bulkCreate(user, dto.missionId, dto.entries || []);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateMailingListEntryDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.service.remove(user, id);
    return { success: true };
  }
}
