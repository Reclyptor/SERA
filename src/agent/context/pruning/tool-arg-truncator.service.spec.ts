import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { ToolArgTruncatorService } from './tool-arg-truncator.service';

describe('ToolArgTruncatorService', () => {
  const service = new ToolArgTruncatorService();

  function buildAssistantWithCall(args: unknown): ModelMessage {
    return {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: '1',
          toolName: 'write',
          args,
        },
      ],
    } as unknown as ModelMessage;
  }

  it('leaves small args untouched', () => {
    const msg = buildAssistantWithCall({ path: 'a.ts', content: 'hi' });
    const { messages, truncated } = service.truncate([msg]);
    expect(truncated).toBe(0);
    expect(messages[0]).toBe(msg);
  });

  it('shrinks large string leaves while preserving JSON validity', () => {
    const longContent = 'x'.repeat(50_000);
    const msg = buildAssistantWithCall({
      path: 'src/foo.ts',
      content: longContent,
    });
    const { messages, truncated } = service.truncate([msg]);
    expect(truncated).toBe(1);
    const part = (
      messages[0].content as Array<{ args: { content: string } }>
    )[0];
    expect(part.args.content.length).toBeLessThan(longContent.length);
    expect(part.args.content.endsWith('...[truncated]')).toBe(true);
    expect(typeof part.args).toBe('object');
  });

  it('re-serializes stringified-JSON args to valid JSON', () => {
    const longContent = 'a'.repeat(2000);
    const argsString = JSON.stringify({
      path: 'src/foo.ts',
      content: longContent,
    });
    const msg = buildAssistantWithCall(argsString);
    const { messages, truncated } = service.truncate([msg]);
    expect(truncated).toBe(1);
    const part = (messages[0].content as Array<{ args: string }>)[0];
    expect(typeof part.args).toBe('string');
    // Critical: result must still parse as valid JSON. A naive mid-string
    // slice would leave an unterminated string and break every subsequent
    // provider call.
    expect(() => JSON.parse(part.args)).not.toThrow();
    const parsed = JSON.parse(part.args) as { content: string; path: string };
    expect(parsed.path).toBe('src/foo.ts');
    expect(parsed.content.endsWith('...[truncated]')).toBe(true);
  });

  it('returns non-JSON string args unchanged', () => {
    const msg = buildAssistantWithCall('not-json-just-text');
    const { messages, truncated } = service.truncate([msg]);
    expect(truncated).toBe(0);
    expect(messages[0]).toBe(msg);
  });

  it('shrinks nested string leaves inside arrays and objects', () => {
    const longContent = 'y'.repeat(2000);
    const msg = buildAssistantWithCall({
      files: [
        { path: 'a.ts', body: longContent },
        { path: 'b.ts', body: 'short' },
      ],
    });
    const { messages, truncated } = service.truncate([msg]);
    expect(truncated).toBe(1);
    const args = (
      messages[0].content as Array<{
        args: { files: Array<{ body: string }> };
      }>
    )[0].args;
    expect(args.files[0].body.endsWith('...[truncated]')).toBe(true);
    expect(args.files[1].body).toBe('short');
  });

  it('does not touch tool-result or other parts', () => {
    const msg = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: '1',
          output: 'r'.repeat(2000),
        },
      ],
    } as unknown as ModelMessage;
    const { messages, truncated } = service.truncate([msg]);
    expect(truncated).toBe(0);
    expect(messages[0]).toBe(msg);
  });
});
