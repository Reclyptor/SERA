import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { WEBHOOK_TRIGGER_KEY } from './webhook-auth.guard';

// `webhook-auth.guard` stamps the resolved trigger record onto the
// request under WEBHOOK_TRIGGER_KEY; this decorator narrows the lookup
// so consumers get a known unknown rather than `any`.
type RequestWithTrigger = Request & {
  [WEBHOOK_TRIGGER_KEY]?: unknown;
};

export const WebhookTrigger = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<RequestWithTrigger>();
    return request[WEBHOOK_TRIGGER_KEY];
  },
);
