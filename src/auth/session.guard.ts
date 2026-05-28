import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { IS_WEBHOOK_PROTECTED_KEY } from './webhook-protected.decorator';
import type { SessionUser } from './session.strategy';

@Injectable()
export class SessionAuthGuard extends AuthGuard('session') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const isWebhookProtected = this.reflector.getAllAndOverride<boolean>(
      IS_WEBHOOK_PROTECTED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isWebhookProtected) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = SessionUser>(
    err: Error | null,
    user: TUser | false,
    _info: unknown,
  ): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Session authentication failed');
    }
    return user;
  }
}
