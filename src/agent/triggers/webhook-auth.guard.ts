import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { TriggersService } from './triggers.service';
import type { Trigger } from './trigger.schema';

export const WEBHOOK_TRIGGER_KEY = 'webhookTrigger';

@Injectable()
export class WebhookAuthGuard implements CanActivate {
  constructor(private readonly triggersService: TriggersService) {}

  private secretsMatch(expected: string, actual: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const path = request.params.path as string | undefined;
    if (!path) {
      throw new NotFoundException('Webhook path is required');
    }

    const trigger = await this.triggersService.findByPath(path);
    if (!trigger) {
      throw new NotFoundException(`No trigger registered for path "${path}"`);
    }

    if (trigger.secret) {
      const incomingSecret = request.headers['x-webhook-secret'] as
        | string
        | undefined;
      if (!incomingSecret || !this.secretsMatch(trigger.secret, incomingSecret)) {
        throw new ForbiddenException('Invalid webhook secret');
      }
    }

    (request as Request & { [WEBHOOK_TRIGGER_KEY]: Trigger })[
      WEBHOOK_TRIGGER_KEY
    ] = trigger;

    return true;
  }
}
