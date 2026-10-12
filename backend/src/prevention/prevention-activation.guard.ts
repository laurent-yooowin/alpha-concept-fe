import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PreventionActivationService } from './prevention-activation.service';

@Injectable()
export class PreventionActivationGuard implements CanActivate {
  constructor(private readonly activation: PreventionActivationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    if (user?.organizationId) await this.activation.assertEnabled(user.organizationId);
    return true;
  }
}
