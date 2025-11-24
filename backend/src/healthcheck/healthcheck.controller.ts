import { Controller, Post, Get, Body, UseGuards, Optional } from '@nestjs/common';

@Controller('healthcheck')
// @UseGuards(JwtAuthGuard)
export class HealthcheckController {
  
  @Get()
  async healthcheck() {
    return "Servic is running, have a fan !";
  }
}
