import { Controller, Get } from '@nestjs/common';
import { AllowNoOrg } from '../common/decorators/scope.decorators';

@Controller('healthcheck')
@AllowNoOrg()
export class HealthcheckController {
  @Get()
  healthcheck() {
    return { status: 'ok' };
  }

  @Get('live')
  live() {
    return { status: 'ok' };
  }
}
