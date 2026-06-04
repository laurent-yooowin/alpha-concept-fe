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
import { ClientService } from './client.service';
import { CreateClientDto, UpdateClientDto } from './client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/permissions.decorator';
import { User } from '../user/user.entity';

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Get()
  @RequirePermission('clients', 'read')
  findAll(@CurrentUser() user: User) {
    return this.clientService.findAll(user);
  }

  @Get(':id')
  @RequirePermission('clients', 'read')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.clientService.findOne(id, user);
  }

  @Post()
  @RequirePermission('clients', 'write')
  create(@Body() dto: CreateClientDto, @CurrentUser() user: User) {
    return this.clientService.create(user, dto);
  }

  @Patch(':id')
  @RequirePermission('clients', 'write')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: User,
  ) {
    return this.clientService.update(id, user, dto);
  }

  @Delete(':id')
  @RequirePermission('clients', 'write')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.clientService.remove(id, user);
  }
}
