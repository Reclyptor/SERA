import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  IMAGE_TOKEN_ESTIMATE,
  PER_MESSAGE_OVERHEAD,
  TokenCounterService,
} from './token-counter.service';

describe('TokenCounterService', () => {
  const service = new TokenCounterService();

  it('counts plain string content with the provider encoder', () => {
    const tokens = service.count('hello world', 'anthropic');
    expect(tokens).toBeGreaterThan(0);
  });

  it('returns zero for null/empty content', () => {
    expect(service.count(null, 'anthropic')).toBe(0);
    expect(service.count('', 'anthropic')).toBe(0);
  });

  it('charges a flat image cost for image parts', () => {
    const tokens = service.count(
      [{ type: 'image', image: Buffer.from('big-binary-payload') }],
      'anthropic',
    );
    expect(tokens).toBe(IMAGE_TOKEN_ESTIMATE);
  });

  it('treats input_image and image_url shapes as images too', () => {
    const a = service.count([{ type: 'input_image' }], 'openai');
    const b = service.count([{ type: 'image_url' }], 'openai');
    expect(a).toBe(IMAGE_TOKEN_ESTIMATE);
    expect(b).toBe(IMAGE_TOKEN_ESTIMATE);
  });

  it('sums text and image parts independently', () => {
    const textOnly = service.count('analyze this', 'anthropic');
    const mixed = service.count(
      [
        { type: 'text', text: 'analyze this' },
        { type: 'image', image: Buffer.from('x') },
      ],
      'anthropic',
    );
    expect(mixed).toBe(textOnly + IMAGE_TOKEN_ESTIMATE);
  });

  it('counts tool-call args by their JSON form', () => {
    const args = { path: 'src/foo.ts', content: 'hello' };
    const tokens = service.count(
      [{ type: 'tool-call', toolCallId: '1', toolName: 'write', args }],
      'anthropic',
    );
    expect(tokens).toBeGreaterThan(0);
  });

  it('counts tool-result outputs', () => {
    const stringResult = service.count(
      [{ type: 'tool-result', toolCallId: '1', output: 'ok' }],
      'anthropic',
    );
    const objectResult = service.count(
      [
        {
          type: 'tool-result',
          toolCallId: '1',
          output: { lines: 10, content: 'x' },
        },
      ],
      'anthropic',
    );
    expect(stringResult).toBeGreaterThan(0);
    expect(objectResult).toBeGreaterThan(0);
  });

  it('adds per-message overhead via countMessage', () => {
    const msg: ModelMessage = {
      role: 'user',
      content: 'hi',
    };
    const raw = service.count('hi', 'anthropic');
    expect(service.countMessage(msg, 'anthropic')).toBe(
      raw + PER_MESSAGE_OVERHEAD,
    );
  });

  it('sums countMessages across a conversation', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    const total = service.countMessages(messages, 'anthropic');
    const expected = messages.reduce(
      (sum, m) => sum + service.countMessage(m, 'anthropic'),
      0,
    );
    expect(total).toBe(expected);
  });

  it('falls back to the default encoder for unknown providers', () => {
    expect(() => service.count('hello', 'mystery-provider')).not.toThrow();
  });
});
