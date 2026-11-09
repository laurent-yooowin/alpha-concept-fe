import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_PENDING_LEGAL_VALIDATION, pendingLegalValidation } from '../organization-access';

export function assertPendingLegalRoute(user: any, handler: Function): void {
  if (user?.[pendingLegalValidation] &&
      !Reflect.getMetadata(ALLOW_PENDING_LEGAL_VALIDATION, handler)) {
    throw new ForbiddenException({
      code: 'ORG_LEGAL_VALIDATION_PENDING',
      message: "Validez les CGU et la politique de confidentialité avant de continuer",
    });
  }
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authorized = await super.canActivate(context);
    const user = context.switchToHttp().getRequest().user;
    assertPendingLegalRoute(user, context.getHandler());
    return Boolean(authorized);
  }
}
