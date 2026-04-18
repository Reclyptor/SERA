import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { WEBHOOK_TRIGGER_KEY } from './webhook-auth.guard';

export const WebhookTrigger = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request[WEBHOOK_TRIGGER_KEY];
  },
);
