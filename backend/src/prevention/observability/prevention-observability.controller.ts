import { Controller, Get, Headers, HttpException, HttpStatus, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AllowNoOrg } from '../../common/decorators/scope.decorators';
import { PreventionObservabilityService } from './prevention-observability.service';

@Controller('internal/prevention')
@AllowNoOrg()
export class PreventionObservabilityController {
  constructor(private readonly observability: PreventionObservabilityService) {}

  @Get('metrics')
  async metrics(
    @Headers('x-prevention-observability-token') token: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.authorize(token, request.ip, 'metrics');
    response.type('text/plain; version=0.0.4').send(await this.observability.metricsText());
  }

  @Get('health')
  async health(@Headers('x-prevention-observability-token') token: string | undefined, @Req() request: Request) {
    this.authorize(token, request.ip, 'health');
    return this.observability.health();
  }

  private authorize(token: string | undefined, ip: string | undefined, scope: 'health' | 'metrics'): void {
    if (!this.observability.isAuthorized(token)) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    if (!this.observability.isClientAllowed(ip)) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    if (!this.observability.consumeScrape(ip!, scope)) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
