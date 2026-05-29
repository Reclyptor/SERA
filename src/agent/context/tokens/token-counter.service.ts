import { Injectable } from '@nestjs/common';
import { getEncoding, type TiktokenEncoding } from 'js-tiktoken';
import type { ModelMessage } from 'ai';

export const IMAGE_TOKEN_ESTIMATE = 1600;
export const PER_MESSAGE_OVERHEAD = 4;

const ENCODING_FOR_PROVIDER: Record<string, TiktokenEncoding> = {
  anthropic: 'cl100k_base',
  openai: 'o200k_base',
  google: 'o200k_base',
  vllm: 'cl100k_base',
};

const IMAGE_PART_TYPES = new Set(['image', 'image_url', 'input_image']);

@Injectable()
export class TokenCounterService {
  private readonly encoders = new Map<string, ReturnType<typeof getEncoding>>();

  count(content: unknown, provider: string): number {
    if (content == null) return 0;
    if (typeof content === 'string') {
      return this.countString(content, provider);
    }
    if (Array.isArray(content)) {
      return this.countParts(content, provider);
    }
    return this.countString(JSON.stringify(content), provider);
  }

  countMessage(message: ModelMessage, provider: string): number {
    return this.count(message.content, provider) + PER_MESSAGE_OVERHEAD;
  }

  countMessages(messages: ModelMessage[], provider: string): number {
    return messages.reduce(
      (sum, msg) => sum + this.countMessage(msg, provider),
      0,
    );
  }

  private countParts(parts: unknown[], provider: string): number {
    let total = 0;
    for (const part of parts) {
      total += this.countPart(part, provider);
    }
    return total;
  }

  private countPart(part: unknown, provider: string): number {
    if (part == null) return 0;
    if (typeof part === 'string') {
      return this.countString(part, provider);
    }
    if (
      typeof part === 'number' ||
      typeof part === 'boolean' ||
      typeof part === 'bigint'
    ) {
      return this.countString(String(part), provider);
    }
    if (typeof part !== 'object') {
      return 0;
    }
    const p = part as { type?: string; [k: string]: unknown };
    if (typeof p.type === 'string' && IMAGE_PART_TYPES.has(p.type)) {
      return IMAGE_TOKEN_ESTIMATE;
    }
    if (p.type === 'text' && typeof p.text === 'string') {
      return this.countString(p.text, provider);
    }
    if (p.type === 'reasoning' && typeof p.text === 'string') {
      return this.countString(p.text, provider);
    }
    if (p.type === 'tool-call') {
      const argsText =
        typeof p.args === 'string' ? p.args : JSON.stringify(p.args ?? {});
      return this.countString(argsText, provider);
    }
    if (p.type === 'tool-result') {
      const out = p.output ?? '';
      const outText = typeof out === 'string' ? out : JSON.stringify(out);
      return this.countString(outText, provider);
    }
    if (p.type === 'file') {
      const data = p.data;
      if (typeof data === 'string') {
        return this.countString(data, provider);
      }
      if (data instanceof Uint8Array) {
        // Approximate 1 token per 4 bytes for binary payloads.
        return Math.ceil(data.byteLength / 4);
      }
      return this.countString(JSON.stringify(p), provider);
    }
    return this.countString(JSON.stringify(p), provider);
  }

  private countString(text: string, provider: string): number {
    if (text.length === 0) return 0;
    return this.encoderFor(provider).encode(text).length;
  }

  private encoderFor(provider: string) {
    const cached = this.encoders.get(provider);
    if (cached) return cached;
    const encoding = ENCODING_FOR_PROVIDER[provider] ?? 'o200k_base';
    const enc = getEncoding(encoding);
    this.encoders.set(provider, enc);
    return enc;
  }
}
