import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NTFY_PRIORITY_MAP,
  type NtfyPublishInput,
  type NtfyPublishResult,
} from './ntfy.types';

const PUBLISH_TIMEOUT_MS = 10_000;

@Injectable()
export class NtfyService {
  private readonly logger = new Logger(NtfyService.name);
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly topic: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService
      .getOrThrow<string>('NTFY_API_URL')
      .replace(/\/+$/, '');
    this.token = this.configService.getOrThrow<string>('NTFY_API_TOKEN');
    this.topic = this.configService.getOrThrow<string>('NTFY_API_TOPIC');

    if (!this.token.startsWith('tk_')) {
      throw new Error(
        'NTFY_API_TOKEN must be a bearer access token (tk_-prefixed). Mint one via POST /v1/account/token.',
      );
    }
  }

  async publish(input: NtfyPublishInput): Promise<NtfyPublishResult> {
    const body: Record<string, unknown> = {
      topic: this.topic,
      message: input.message,
    };
    if (input.title) body.title = input.title;
    if (input.priority) body.priority = NTFY_PRIORITY_MAP[input.priority];
    if (input.tags && input.tags.length > 0) body.tags = input.tags;
    if (input.click) body.click = input.click;
    if (input.actions && input.actions.length > 0) body.actions = input.actions;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);

    try {
      let response: Response;
      try {
        response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Error(
            `ntfy publish timed out after ${PUBLISH_TIMEOUT_MS}ms`,
          );
        }
        throw err;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `ntfy publish failed: ${response.status} ${response.statusText}${
            text ? ` — ${text}` : ''
          }`,
        );
      }

      const payload = (await response.json()) as { id?: string };
      if (!payload.id) {
        throw new Error('ntfy publish response missing message id');
      }

      this.logger.debug(
        `Published ntfy message id=${payload.id} topic=${this.topic}`,
      );
      return { id: payload.id };
    } finally {
      clearTimeout(timeout);
    }
  }
}
