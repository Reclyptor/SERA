import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SessionUser } from './session.strategy';

export const CurrentUser = createParamDecorator(
  (
    data: keyof SessionUser | undefined,
    ctx: ExecutionContext,
  ): SessionUser | any => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as SessionUser;

    return data ? user?.[data] : user;
  },
);
