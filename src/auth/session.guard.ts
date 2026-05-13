import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { IS_WEBHOOK_PROTECTED_KEY } from './webhook-protected.decorator';

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

  handleRequest(err: any, user: any, _info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Session authentication failed');
    }
    return user;
  }
}
