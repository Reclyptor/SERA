import { SetMetadata } from '@nestjs/common';

export const IS_WEBHOOK_PROTECTED_KEY = 'isWebhookProtected';
export const WebhookProtected = () =>
  SetMetadata(IS_WEBHOOK_PROTECTED_KEY, true);
