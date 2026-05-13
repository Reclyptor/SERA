import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { TriggersService } from './triggers.service';
import type { Trigger } from './trigger.schema';

export const WEBHOOK_TRIGGER_KEY = 'webhookTrigger';

@Injectable()
export class WebhookAuthGuard implements CanActivate {
  constructor(
    private readonly triggersService: TriggersService,
    private readonly configService: ConfigService,
  ) {}

  private secretsMatch(expected: string, actual: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private extractWebhookApiKey(request: Request): string | undefined {
    const apiKeyHeader = request.headers['x-webhook-api-key'];
    if (typeof apiKeyHeader === 'string') {
      return apiKeyHeader;
    }

    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length).trim();
    }

    return undefined;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const webhookApiKey = this.configService.get<string>('WEBHOOK_API_KEY');

    if (!webhookApiKey) {
      throw new InternalServerErrorException(
        'WEBHOOK_API_KEY is not configured',
      );
    }

    const incomingApiKey = this.extractWebhookApiKey(request);
    if (!incomingApiKey || !this.secretsMatch(webhookApiKey, incomingApiKey)) {
      throw new ForbiddenException('Invalid webhook API key');
    }

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
      if (
        !incomingSecret ||
        !this.secretsMatch(trigger.secret, incomingSecret)
      ) {
        throw new ForbiddenException('Invalid webhook secret');
      }
    }

    (request as Request & { [WEBHOOK_TRIGGER_KEY]: Trigger })[
      WEBHOOK_TRIGGER_KEY
    ] = trigger;

    return true;
  }
}
