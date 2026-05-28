import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from './session.strategy';

type RequestWithUser = Request & { user?: SessionUser };

export const CurrentUser = createParamDecorator(
  <K extends keyof SessionUser>(
    data: K | undefined,
    ctx: ExecutionContext,
  ): SessionUser | SessionUser[K] | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
